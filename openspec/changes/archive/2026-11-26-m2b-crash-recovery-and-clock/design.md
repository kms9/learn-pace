# Design

## Context

参见 `proposal.md`、`docs/prd/08-local-persistence.md` §10.1 与 Change 7 的 `transactional-persistence` 规格。M2-A 与 `m2a-mobile-ux-polish` 已归档；本 Change 在 Change 7 验收归档后实施，补齐冷启动全局对账（含题组逐小题对账）、Host 故障注入测试套件与设备时钟回拨验收样本。

## Goals / Non-Goals

**Goals:**
- `RecoveryService` 同时提供独立冷启动入口 `reconcileAll()` 与事务内复用入口 `reconcileInTransaction(tx)`（供 Change 9 在原子恢复事务内直接复用），保证纯本地、幂等、零网络调用。
- 严格遵守「先逐小题恢复评分展示 → 再判定整卡状态 → 最后按进度优先级清理同路径重复未结束题卡」的三步顺序，兼容题组部分完成态。
- 提供 `FaultInjectingAppStore` 与明确区分「回拨只浏览」和「回拨提交新评分」的时钟回归样本。

**Non-Goals:**
- 不在启动对账时自动发起任何外部 LLM 请求。
- 不修改 Change 7 的 SQLite v5 表结构。
- 不包含备份与恢复（Change 9）。

## Decisions

### 1. 全局启动对账与题组逐小题规则（`packages/app-host/src/recovery.ts`）
- 新增 `RecoveryService(store, clock, makeId)`，提供 `reconcileInTransaction(tx: AppStore)` 与 `reconcileAll()`（内部开启单个 `store.runInTransaction((tx) => this.reconcileInTransaction(tx))`），由 `AppBootstrapService.recoverOnStartup()` 调用，返回 `RecoveryReport`（`interruptedMessages`、`reconciledGradedCards`、`reconciledPartialCards`、`pendingRetryCards`、`abandonedDuplicateCards`）：
  1. **全会话流式消息对账**：遍历 `tx.listSessions()`（`lf01`、`little_tutor`、`mastery`），把遗留 `generating` 助手消息标为 `interrupted`，为缺失助手行的已提交用户消息补齐 `interrupted` 占位。判定规则复用现有 `ChatTurns.recover(session)`：将其判定逻辑抽为纯函数，由 `RecoveryService` 在 `tx` 上写入；`Lf01ChatService` 与 `MasterySessionService` 上现有的 `recoverInterruptedTurns()` 删除，相关测试迁移到 `crash-recovery.test.ts`。
  2. **题卡逐小题对账（先于重复卡清理）**：按路径读取所有 `status IN ('awaiting_input', 'answered')` 的题卡，与所属 `learning_progress` 的 `learning_evidence` 逐一核对：
     - **Step A（逐叶题恢复展示态）**：遍历 `questionLeaves(row.question)` 中每个非作废小题，计算其 `evidence_id`（单题 `row.interaction_id`，题组 `${row.interaction_id}:${leaf.question_id}`）。若 `learning_evidence` 已存在对应记录而 `row.grade.questions[leaf.question_id]` 尚未标为 `final`，则从已提交证据重建 `QuestionGrade` 写入展示态（绝不再次调用 `applyGrade`）。
     - **Step B（判定整卡状态）**：设 `answers = savedAnswers(row)`，检查全部非作废叶题：
       - 若全部非作废叶题均已 `final`（`ready(row, grades) === true`）→ 整卡纠偏为 `graded`；
       - 否则，若存在**已填写非空答案但尚无对应证据**的叶题（即保存答案后、判定前/中崩溃）→ 整卡保持 `answered`，保留 `raw_answer`、`submission_id` 与已恢复的部分小题 `grade`，供用户手动触发重试批改；
       - 否则（所有已填叶题均已有证据，但题组仍有未填答案的剩余叶题，或整卡尚未作答）→ 整卡保持 `awaiting_input`（保留已恢复的部分小题 `grade` 与 `raw_answer`，学习者可继续作答剩余小题）。
     - **Step C（最后清理同路径重复未结束题卡）**：经 Step A/B 后，对同一 `path_id` 下仍处于 `awaiting_input` / `answered` 的题卡，若数量 > 1，按以下确定性优先级排序保留第 1 张，其余置为 `abandoned`：
       1. 状态与进度权重：`answered`（3） > 含已批改小题或已存部分答案的 `awaiting_input`（2） > 空白 `awaiting_input`（1）；
       2. 同权重下按 `(updated_at DESC, interaction_id DESC)` 保留最新一条。
       这样绝不会因简单按 `updated_at` 截断而误删已有答案/已评部分小题的题卡，也不会把其实已全量批改完的新卡错当成未结束卡。

### 2. Host 故障注入夹具（`packages/infra/src/testing/fault-store.ts`）
- 新增测试专用 `FaultInjectingAppStore`，经 `packages/infra/package.json` 的 `exports` 新增 `"./testing": "./src/testing/fault-store.ts"` 暴露为 `@learn-pace/infra/testing`，生产代码（`apps/mobile` 与 `packages/app-host/src` 非测试文件）不得引用。它包装任意 `AppStore`（`MemoryAppStore`，或 Change 7 测试中基于 `node:sqlite` mock 的 `ExpoLearningStore`）：
  - 支持在任意写操作（`insertInteraction`、`saveAnswer`、`updateInteraction`、`saveWithCas`、`commitTransaction`、`saveMessage`、`appendDomainEvent`）前/后注入一次性 `InjectedCrashError`；
  - 每次注入崩溃后重新实例化 `AppBootstrapService` / `MasterySessionService` / `Lf01ChatService`（模拟进程重启清空内存状态），执行 `recoverOnStartup()` 并验证结果。
- 覆盖矩阵（`packages/app-host/src/__tests__/crash-recovery.test.ts`）：
  - 出题后崩溃、作答保存后判定前/中崩溃、评分事务提交后 UI 刷新前崩溃；
  - 历史单题 `answered`+已有证据纠偏为 `graded`、历史 3 小题题组 1 题已计分 2 题待答保持 `awaiting_input`、同路径保留有答案旧卡并放弃空白重复卡；
  - 大纲预览重启失效、`mastery_repair_question` 失败回滚与 `recoverOnStartup()` 多次重复调用幂等。

### 3. 时钟回拨的「只浏览」与「实际提交评分」明确口径与回归样本
- 基于 `packages/domain/src/scheduler.ts` 已有的负时间差钳制（`moment = Math.max(eventMoment, state.last_review_at)`、`elapsedDays = Math.max(0, ...)`），明确两类行为约定并用回归测试锁定精确预期：
  1. **回拨期间只浏览（只读投影 `dueReviews`、`reviewPlan`、`forgetting_risk`）**：
     - 设基线 `T0` 已完成评分、`last_review_at = T0`、`next_review_at = T0 + 3d`、`lapse_count = 0`。当设备时钟回拨至 `T0 - 2d` 并仅查询学习首页/路径页/复习计划：
     - `elapsed` 钳制为 `0` → `retrievability = 1.0`、`forgetting_risk = 0`（无 `NaN`/负值）；
     - 因 `T0 - 2d < next_review_at`，该项不计入到期数（`dueCount` 不虚增）；
     - 磁盘存储的 `next_review_at`、`last_review_at`、`stability`、`lapse_count` **零改动**；当时钟恢复至 `T0 + 4d` 时，该项正常到期。
  2. **回拨期间实际提交新评分（写入 `scheduleReview`）**：
     - 同一基线在 `T0 - 2d` 实际提交一次新评分，`scheduler` 将有效时刻钳制为 `moment = max(T0 - 2d, T0) = T0`（`elapsedDays = 0 < sameSessionDays`）：
     - **答对（`quality >= 0.5`）**：进入同会话分支 → `review_count` 加 1，`last_review_at` 维持 `T0`（不倒退），`next_review_at`、`stability`、`lapse_count` 均保持不变；
     - **独立答错（`quality < 0.5`）**：进入失误分支 → `lapse_count` 加 1，`stability` 下降，从 `moment = T0` 起计算缩短后的 `next_review_at`（严格大于 `T0`，绝不产生倒退的负间隔），掌握度按规则回落且离开复习计划。
- 回归套件（`packages/app-host/src/__tests__/clock-review-regression.test.ts`）锁定完整跨 30 天样本（含上述两类回拨场景 + 多知识点交错到期 + 五连对补救 + 提前结束 + 保持目标重排）。

### 4. UI 启动对账与恢复态（基于已归档的 `m2a-mobile-ux-polish`）
- `apps/mobile/src/context/AppContext.tsx` 打开 `ExpoLearningStore` 后先调用 `service.recoverOnStartup()` 再读取首屏 `snapshot()`，并删除现有的 `chat.recoverInterruptedTurns()` 与 `mastery.recoverInterruptedTurns()` 两处调用；
- 核对学习首页「该做的事」与精通会话题卡对 `answered`（待重试评分）、部分完成题组（`awaiting_input`）与 `interrupted` 的展示，确保用户无需重填原答案即可一键重试。

## Risks / Trade-offs

- **[Risk] 题组对账若按简单 `updated_at` 清理重复卡，会误删已保存作答或已批改部分小题的题卡** → Mitigation：严格按 Step A（逐小题恢复）→ Step B（整卡状态判定）→ Step C（按进度权重去重）执行，并由单测覆盖。
- **[Risk] 冷启动遍历全部会话可能随数据增长增加耗时** → Mitigation：全部对账集中在单次短事务内完成且仅对含未完结状态的行执行写入，保持毫秒级启动。
