# transactional-persistence Specification

## Purpose

定义 Learn Pace 在 M2-B 加固阶段的数据一致性保障：核心跨表写入的短原子事务、跨连接写入串行化、`learning_progress.version` 乐观锁（CAS）、基于 `interactions.submission_id` 的幂等提交、晚到结果防护与领域事件审计记录（对应 NFR-02、NFR-03、AC-05）。

## Requirements

### Requirement: Atomic short transactions with external model calls outside locks
Grading commits, outline build and revision commits, question void or answer-key repair commits, and topic reset or deletion MUST execute within a single short SQLite transaction covering progress, interaction state, and domain event writes; external model requests MUST run outside any database transaction, and late model results (success or failure markers) MUST re-verify the card status and `submission_id` inside the transaction before writing.

#### Scenario: Grading commit succeeds atomically
- **WHEN** 语义判定在事务外返回定论结果并提交评分
- **THEN** 进度聚合（作答、证据、错因、掌握度、复习状态）、题卡状态与 `AssessmentCommitted` 领域事件在同一个短事务内全部提交

#### Scenario: Write failure rolls back all partial changes
- **WHEN** 评分提交、题目作废重算或删除主题在事务中任一写入步骤失败
- **THEN** 事务整体回滚，路径进度、题卡状态与会话数据保持事务前一致，不留下半更新记录

#### Scenario: Late grading result cannot overwrite a newer submission
- **WHEN** 语义判定在事务外返回成功或失败结果时，题卡已被放弃或已更新为新的 `submission_id`
- **THEN** 事务内核对题卡状态与 `submission_id` 不匹配并丢弃该晚到结果，不覆盖新作答或标记新卡失败

### Requirement: Serialized local writes across database connections
The storage layer SHALL serialize all local writes, including writes issued while another path's transaction is open on a separate connection, so that concurrent chat streaming and mastery commits never fail with a database lock error.

#### Scenario: Chat streaming continues during a grading commit
- **WHEN** 问答会话正在流式输出并周期性保存回复，同时另一条精通路径提交评分事务
- **THEN** 两者的写入依次完成，回复最终状态正常落库，评分事务原子提交，不出现 `database is locked` 错误

### Requirement: Optimistic concurrency control (CAS) on learning progress version
Every progress mutation (grading, qualitative assessment, outline build or revision, repair, reset, rename, learner override, and review strategy or retention update) SHALL check `learning_progress.version` against the expected revision inside the write transaction and MUST uniformly reject any stale version with a conflict error while preserving the newer progress and any already-saved learner answer.

#### Scenario: Outline revision commit rejects a stale version
- **WHEN** 预览生成后路径进度被另一操作更新导致 `version` 递增，随后提交旧预览
- **THEN** CAS 校验检测到版本不匹配并拒绝写入，原大纲、进度与证据保持完整不受影响

#### Scenario: Stale grading commit is rejected without losing the saved answer
- **WHEN** 语义判定在事务外执行期间 `learning_progress.version` 发生变化，随后提交本次评分
- **THEN** 评分事务因 CAS 冲突统一拒绝写入，保留已保存的原始答案（`answered`）与较新进度，由用户重试批改

### Requirement: Submission idempotency and stale interaction rejection
Learner answer submission SHALL carry a unique client-generated `submission_id`. Resubmitting the same `submission_id` with an identical answer MUST return the existing graded card without duplicating messages or tutor turns once final, and MUST resume grading without double scoring while still pending; reusing a `submission_id` with another answer or card, or submitting to a closed card, MUST be rejected.

#### Scenario: Resubmitting a graded submission returns the card without a new tutor turn
- **WHEN** 同一题卡以相同 `submission_id` 和相同作答内容在批改定论后再次提交
- **THEN** 系统直接返回当前题卡及其批改结果，不重复计分、不新增用户消息、也不触发导师回合

#### Scenario: Resubmitting a pending submission resumes grading without double scoring
- **WHEN** 作答已保存但上次批改中断或失败（题卡仍为 `answered`），学习者以相同 `submission_id` 和相同作答再次提交
- **THEN** 系统发起一次批改回合，已写入的证据被复用、不重复计分，题卡最终得到定论

#### Scenario: Reusing a submission ID with a different answer is rejected
- **WHEN** 调用方用已存在的 `submission_id` 提交不同的作答内容，或将其用于另一张题卡
- **THEN** 系统拒绝请求，原题卡、作答与证据保持不变

#### Scenario: Submitting to a closed card is rejected
- **WHEN** 用户对已放弃（`abandoned`）或已批改关闭（`graded`）的题卡发起新 `submission_id` 提交
- **THEN** 系统拒绝提交并刷新最新题卡状态

### Requirement: Domain event audit trail
Committed learning mutations (`AnswerRecorded`, `AssessmentCommitted`, `OutlineCommitted`, `AssessmentVoided`, `AssessmentCorrected`) SHALL append audit records to `domain_events` inside the same transaction as the state change, and deleting a topic SHALL remove that topic's audit records together with its other data.

#### Scenario: Auditing committed grading and repair mutations
- **WHEN** 系统完成一次评分提交，随后导师通过 `mastery_repair_question` 作废该题
- **THEN** `domain_events` 按提交顺序记录 `AssessmentCommitted` 与 `AssessmentVoided`，各包含 `path_id`、`session_id`、`turn_id` 与操作载荷

#### Scenario: Deleting a topic removes its audit events
- **WHEN** 学习者删除一条精通路径
- **THEN** 该路径的题卡、精通会话与消息、进度及 `domain_events` 在同一事务内全部删除，其他路径的记录不受影响
