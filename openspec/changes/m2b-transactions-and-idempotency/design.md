# Design

## Context

参见 `proposal.md`、`docs/prd/07-data-flow.md` §8.5 与 `docs/prd/08-local-persistence.md` §10。M2-A 与 `m2a-mobile-ux-polish` 已归档；当前存储为 SQLite v4 的 `ExpoLearningStore` 与 `MemoryAppStore`，`StudyInteractions`、`MasterySessionService` 仍采用顺序落库。本 Change 在不修改领域算法的前提下，将存储层与 Host 核心写路径升级为短原子事务 + 统一 CAS + 幂等提交。

现状中已存在、本 Change 在其上加固而不重复实现的保护：

- **单路径互斥**：`MasterySessionService.withPath` 经 `ChatTurns.exclusively(pathId)` 串行化同一路径的全部写操作与导师回合，同一路径的并发提交直接被拒绝。
- **证据去重**：`StudyInteractions.grade` 按 `evidence_id`（单题为 `interaction_id`，题组为 `interaction_id:question_id`）复用已有证据，不再调用模型或 `applyGrade`，重复批改不会重复计分。
- **UI 防连点**：精通会话页 `perform()` 以 `active` ref 拦截重复点击。

因此在单进程内，"语义判定期间 `version` 被改写"与"晚到结果覆盖新作答"属于纵深防御场景：本 Change 仍实现 CAS 与晚到防护，但相应测试需直接驱动 `StudyInteractions` 或绕过 `withPath` 构造。真机上真实存在的风险是**跨路径并发写**（问答流式落库与精通评分事务同时发生）以及**进程在多步写入之间被杀**，这是本 Change 的重点。

```
  问答会话 (scope = sessionId)          精通路径 (scope = pathId)
  ------------------------------        ------------------------------
  流式回复: 每 ~1s saveMessage   ---+   评分: runInTransaction(...)
  回合结束: saveMessage(terminal)   |          |
                                    v          v
                           +----------------------------+
                           | ExpoLearningStore 写入队列  |  <- 本 Change 新增
                           +----------------------------+
                                    |          |
                              主连接 db     事务连接 txn (withExclusiveTransactionAsync 新开)
```

## Goals / Non-Goals

**Goals:**
- `ExpoLearningStore` 与 `MemoryAppStore` 具备语义一致的 `runInTransaction` 与 `saveWithCas`；SQLite 实现在 Node 下通过 `node:sqlite` 双连接 mock 验证回滚、CAS 与跨连接写入行为。
- 跨路径并发写入（问答流式落库、精通评分事务）在 Android 上不出现 `database is locked`。
- 外部模型判定（`assessSemantically`）严格在数据库事务外执行；回写结果（含失败标记）前在事务内重新核对题卡状态、`submission_id` 与 `version`。
- `submission_id` 由移动端生成并贯通 `MasterySessionService.submitAnswer`；已定论的重复提交不重复写消息、不重复开导师回合。

**Non-Goals:**
- 不新增独立的 `submissions` 回执表：应用为单进程、客户端与 Host 之间没有网络重试链路，幂等以 `interactions.submission_id` 唯一索引 + `raw_answer` 比对实现即可。
- 不在事务内调用任何网络/模型接口。
- 不做冷启动全局对账与故障注入测试套件（Change 8）。
- 不做备份与恢复（Change 9）。

## Decisions

### 1. SQLite v5 迁移（`packages/infra/src/migrations.ts`）
- `schemaVersion` 由 `4` 升至 `5`；迁移链改为 `if (version < 2) migrateV2; if (version < 3) migrateV3; if (version < 4) migrateV4; migrateV5`（当前 `migrateV4` 为无条件调用，需改为条件调用）。
- `migrateV5(db)` 整体包裹在 `BEGIN IMMEDIATE … COMMIT` 中，任一步失败 `ROLLBACK` 并重抛；各步骤幂等：
  1. `learning_progress` 检测并补齐 `version INTEGER NOT NULL DEFAULT 0` 列，回填 `UPDATE learning_progress SET version = CAST(COALESCE(json_extract(progress, '$.version'), 0) AS INTEGER) WHERE json_valid(progress)`；
  2. **历史重复 `submission_id` 防御性清理**：v4 的 `submission_id` 均由 `randomUUID` 生成，实际几乎不会重复。对每组重复的非空 `submission_id`，按 `(updated_at DESC, interaction_id DESC)` 保留第一行，其余行的 `submission_id` 置为 `NULL`。不改写 `messages`：旧消息中的 `mastery_answer.submission_id` 与题卡不再匹配时，`pregrade` 现有逻辑会将其视为过期作答而忽略；
  3. 创建唯一索引：`CREATE UNIQUE INDEX IF NOT EXISTS interactions_submission_unique ON interactions (submission_id) WHERE submission_id IS NOT NULL`；
  4. 新增 `domain_events` 表：
     ```sql
     CREATE TABLE IF NOT EXISTS domain_events (
       event_id TEXT PRIMARY KEY NOT NULL,
       path_id TEXT NOT NULL,
       session_id TEXT,
       turn_id TEXT,
       event_type TEXT NOT NULL,
       payload TEXT NOT NULL,
       created_at REAL NOT NULL
     );
     CREATE INDEX IF NOT EXISTS domain_events_by_path ON domain_events (path_id, created_at DESC, event_id);
     ```
  5. 最后写入 `PRAGMA user_version = 5`（与前述步骤同一事务提交）。

### 2. 事务、写入队列与 CAS 契约（`packages/infra`）
- 新增错误类 `VersionConflictError`（CAS 冲突）与 `SubmissionConflictError`（`submission_id` 与作答或题卡不匹配）。
- `AppStore` 扩展：
  - `runInTransaction<T>(work: (tx: AppStore) => Promise<T>): Promise<T>`：
    - `work` 内的全部读写**只能**通过 `tx`。在 `work` 内调用外层 store 的写方法会等待自身已占用的写入队列而死锁，由约定、代码评审与测试超时把关；
    - `tx.runInTransaction(fn)` 可重入，直接执行 `fn(tx)`。
  - `saveWithCas(progress: LearningProgress, expectedVersion: number | null, status?: PathStatus): Promise<void>`：
    - `expectedVersion === null`（新建路径）：`INSERT`，已存在则抛 `VersionConflictError`；
    - `expectedVersion !== null`：要求 `progress.version === expectedVersion + 1`，执行 `UPDATE learning_progress SET progress = ?, name = ?, updated_at = ?, status = COALESCE(?, status), version = ? WHERE path_id = ? AND version = ?`，`changes !== 1` 时抛 `VersionConflictError`。
  - 现有 `save(progress, status?)` 保留（仅开发用 `StudyWorkbench` 继续使用），但必须同步写入 `version` 列为 `progress.version`，保证列与 JSON 不漂移。
  - `findInteractionBySubmission(submissionId)`：供幂等判定。
  - `appendDomainEvent(event)`、`listDomainEvents(pathId, limit?)`、`deleteDomainEventsByPath(pathId)`。
- `ExpoLearningStore`：
  - 打开数据库后执行 `PRAGMA busy_timeout = 5000` 作为兜底。
  - 维护内部**写入队列**（Promise 链）：所有写方法与 `runInTransaction` 经该队列串行执行；读方法不排队（WAL 下读不阻塞写）。
  - `runInTransaction` 占住队列后调用 `db.withExclusiveTransactionAsync(async (txn) => …)`，先对 `txn` 执行 `PRAGMA busy_timeout = 5000`，再以 `txn` 为执行器构造事务视图（复用同一套 SQL 方法、不经过队列）传给 `work`。
  - 理由：`withExclusiveTransactionAsync` 会新开一个连接，而 `ChatTurns.generate` 在流式输出时每秒于主连接写一次消息、结束时再写最终消息（后者未捕获异常）。不排队时主连接写入会在事务期间报 `database is locked`，回复将停留在 `generating`。
- `MemoryAppStore`：使用同样的写入队列；事务开始时深拷贝快照，`work` 抛错则恢复快照并重抛。
- 测试：`migration-sql.test.ts` 的 expo-sqlite mock 增加 `withExclusiveTransactionAsync`，用**第二个 `DatabaseSync` 连接**打开同一文件执行 `BEGIN EXCLUSIVE … COMMIT/ROLLBACK`，以在 Node 下复现跨连接锁冲突并验证写入队列的必要性。

### 3. 幂等提交（`packages/app-host`）
- 签名：
  ```ts
  submitAnswer(pathId: string, sessionId: string, interactionId: string, answers: Answers, submissionId: string): Promise<SubmitAnswerResult>;
  type SubmitAnswerResult =
    | { kind: "turn"; message: StoredMessage }
    | { kind: "receipt"; card: StudyCard };
  ```
- `StudyInteractions.stage(row, answers, submissionId)` 改为接收调用方提供的 ID；导师判题路径（`gradeFromTurn`，无客户端 ID）仍由服务端 `makeId()` 生成。
- 判定顺序（在 `withPath` 内、写任何消息之前）：
  1. 用与 `stage` 相同的算法计算本次提交合并后的规范化 `raw_answer`；
  2. `findInteractionBySubmission(submissionId)` 命中**其他题卡** → 抛 `SubmissionConflictError`；
  3. 命中**本题卡**（`row.submission_id === submissionId`）：
     - `raw_answer` 不同 → 抛 `SubmissionConflictError`；
     - 题卡为 `graded`，或为 `awaiting_input` 且本次提交涉及的小题均已有定论 → 返回 `{ kind: "receipt", card }`，不写消息、不开回合；
     - 题卡为 `answered`（待评分或上次判定失败）→ 等价于 `retryAnswer`：发起一次批改回合，`grade()` 按 `evidence_id` 复用已有证据，不重复计分；
  4. 未命中（新 ID）：题卡必须为 `awaiting_input` 或 `answered`，`graded` / `abandoned` 抛错并提示刷新；在一个短事务内写入作答（`status = answered`、新 `submission_id`）与 `AnswerRecorded` 事件，随后发起导师回合。
- 同一题卡更早的 `submission_id` 不单独留存：旧界面以旧 ID 重放时按新 ID 处理，并受第 4 步的题卡状态约束（已结束的题卡会被拒绝）。

### 4. 评分提交：锁外判定 + 事务内核对（`StudyInteractions.grade`）
1. 事务外读取题卡快照（记录 `expectedSubmissionId = row.submission_id`）与当前 `progress`（记录 `baseVersion = progress.version`）；
2. 事务外执行证据复用或 `assessSemantically`；
3. **判定抛错**：进入短事务重新读取题卡，仅当 `latest.status === "answered" && latest.submission_id === expectedSubmissionId` 时写入 `grading_failed = true` 并保留原答案，否则丢弃该晚到失败标记；
4. **判定返回**：进入 `runInTransaction`：
   - 重新读取题卡与进度；题卡状态不是 `answered` 或 `submission_id` 不匹配 → 丢弃结果（防晚到覆盖新作答）；
   - `latestProgress.version !== baseVersion` → 抛 `VersionConflictError`（保留 `answered` 原答案，不做隐式重放，由用户重试批改）；
   - 校验通过后在同一事务内执行 `applyGrade` → `saveWithCas(next, baseVersion, derivePathStatus(next))` → 更新题卡为 `graded` / `awaiting_input` → 追加 `AssessmentCommitted` 事件。

### 5. 其他进度写入统一走 CAS（`packages/app-host`）
- `MasterySessionService.persist(progress, outline)` 改为在事务内执行 `saveWithCas({ ...progress, version: progress.version + 1, updated_at: now }, progress.version, derivePathStatus(next))`；`outline = true` 时将放弃不兼容题卡与进度写入放在同一事务，并追加 `OutlineCommitted`。由此所有经 `persist` 的调用方自动获得 CAS：`mastery_build`、`mastery_revise`（直接修改与预览提交）、`mastery_note_explained`、`mastery_defer_objective`、`setObjectiveMastery`、`setReviewStrategy`、`setDesiredRetention`、`renameTopic`。
- `mastery_assess`：判定在事务外；进度与 `mastery_assessment_pending` 消息元数据在同一事务内提交，并追加 `AssessmentCommitted`。
- `mastery_repair_question`：重新判定在事务外；进度、题卡与 `AssessmentVoided` / `AssessmentCorrected` 在同一事务内提交。
- `createTopic`：`saveWithCas(progress, null, status)`。
- `resetTopic`：单事务内放弃全部未结束题卡并 `saveWithCas`；保留历史 `domain_events`。
- `deleteTopic`：单事务内删除题卡、精通会话及消息、`learning_progress` 与该路径的 `domain_events`（与 NFR-07「用户可删除」一致）。
- 领域事件类型限定为 `AnswerRecorded`、`AssessmentCommitted`、`OutlineCommitted`、`AssessmentVoided`、`AssessmentCorrected`；改名、复习策略、保持目标与自评掌握只做 CAS，不写事件。
- `mastery_build` / `mastery_revise` 的实现位于 `packages/app-host/src/mastery/tools/index.ts`（`tools/outline.ts` 仅含纯规划函数）。

### 6. 移动端提交与冲突反馈（`apps/mobile`）
- `QuestionCard` 为每次未完成作答维护 `submissionId`（`randomUUID`，作答内容变化时刷新），提交时调用 `submit(answers, submissionId)`；会话页将其透传给 `submitAnswer`。
- 收到 `SubmissionConflictError`、`VersionConflictError` 或题卡已结束错误时，使用 `m2a-mobile-ux-polish` 的语义错误样式提示并刷新会话与题卡投影；收到 `{ kind: "receipt" }` 时只刷新投影。

## Risks / Trade-offs

- **[Risk] 写入队列使跨路径写入串行化** → Mitigation：事务内只有本地 SQL、没有网络调用，持有时间为毫秒级；相对每秒一次的流式落库，排队影响可忽略。
- **[Risk] 在 `work` 内误用外层 store 的写方法会死锁** → Mitigation：`AppStore` 文档与评审约定只用 `tx`；`MemoryAppStore` 与 SQLite 实现行为一致，误用在单测中表现为超时，可被发现。
- **[Risk] 统一拒绝旧 `version` 时用户需手动重试一次** → Mitigation：单进程内 `withPath` 已串行化同路径写入，实际几乎不会触发；原答案已落库不会丢失。
- **[Risk] 迁移置空重复 `submission_id` 后，对应旧消息无法再触发预批改** → Mitigation：被置空的是同组中较旧的行，且仅存在于理论上的 v4 历史数据；保留行仍可正常重试批改。
- **[Trade-off] 不保留同一题卡的历史 `submission_id`** → 旧 ID 的重放按新提交处理并受题卡状态约束，换取无需额外回执表的简单实现。
