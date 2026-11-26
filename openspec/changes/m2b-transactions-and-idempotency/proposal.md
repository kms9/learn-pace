# Proposal

## Why

M2-A 按决策 D3 采用顺序落库快速跑通了 LF01 与 LF02 全流程，但当前 `ExpoLearningStore` 缺少短事务封装、`learning_progress` 缺少版本 CAS 校验、`interactions.submission_id` 缺少唯一约束与幂等去重表。在评分提交（写进度 → 更新题卡）、大纲修订提交、`mastery_repair_question` 作废/更正重算以及删除主题等跨表写入中，一旦在两次写入之间进程崩溃或发生重复提交/并发修改，就可能出现半更新状态或重复计分。进入 M2-B 加固阶段，首先补齐原子短事务、版本 CAS 与严格幂等（NFR-02、NFR-03、AC-05）。

## What Changes

- **SQLite v5 迁移与事务/CAS 存储契约（`packages/infra`）**：
  - 数据库升级至 SQLite v5：为 `learning_progress` 新增整型 `version` 索引列（与 JSON 内 `progress.version` 同步并支持 CAS）；为 `interactions.submission_id` 建立非空唯一索引；新增 `domain_events` 轻量审计事件表（`event_id`、`path_id`、`session_id`、`turn_id`、`event_type`、`payload`、`created_at`）。
  - `AppStore` 新增原子短事务边界 `runInTransaction(fn)`（`ExpoLearningStore` 底层走 `expo-sqlite` 独占事务，`MemoryAppStore` 通过内存快照实现等价的失败全量回滚）与带 `expectedVersion` 的 `saveWithCas(progress, expectedVersion, status)`。
  - `ExpoLearningStore` 内部以写入队列串行化全部写入并设置 `busy_timeout`：独占事务会新开连接，若不排队，问答流式落库会在精通评分事务期间报 `database is locked`。
- **核心跨表写入事务化与锁外模型调用（`packages/app-host`）**：
  - **作答提交与评分提交**：`submission_id` 由移动端生成并贯通 `submitAnswer`；答案先落库（幂等：相同 `submission_id` + 相同作答在已定论时直接返回当前题卡、在待评分时恢复批改且不重复计分，相同 `submission_id` + 不同作答或已关闭题卡受控拒绝）；外部语义判定（`assessSemantically`）严格在数据库事务锁外执行；判定完成后在单个短事务中执行 `learning_progress` CAS + 写证据/掌握/复习状态 + 更新题卡状态 + 写入 `AssessmentCommitted` 领域事件。
  - **大纲建出与修订提交**：`mastery_build`、`mastery_revise`（直接修改与预览提交）走 `saveWithCas` 短事务并写入 `OutlineCommitted` 事件；版本冲突时明确拒绝并提示刷新/重新预览，保留原大纲与证据。
  - **题目作废与更正（`mastery_repair_question`）**：外部重新判定在锁外完成后，在单个短事务内以 CAS 提交重算后的进度、更新题卡状态并写入 `AssessmentVoided` / `AssessmentCorrected` 事件。
  - **删除主题与重置进度**：在单个短事务内原子删除或重置关联路径、会话、消息与题卡，消除残留孤儿记录。
- **UI 冲突提示对齐（`apps/mobile`）**：沿用 `m2a-mobile-ux-polish` 完成后的语义色与提示样式，在过期题卡、重复点击提交或版本冲突时展示清晰可恢复反馈并自动刷新界面投影。

### Non-Goals / Out of Scope
- **不包含冷启动全场景崩溃对账与故障注入测试套件**（留给 Change 8 · `m2b-crash-recovery-and-clock`）。
- **不包含本地备份导出与恢复**（留给 Change 9 · `m2b-backup-and-restore`）。
- **不做完整 Event Sourcing**：`domain_events` 仅用于审计追踪与 Change 8 的启动对账，不替代 `learning_progress` 权威状态。
- **不新增独立的 `submissions` 回执表**：应用为单进程、客户端与 Host 之间没有网络重试链路，幂等以 `interactions.submission_id` 唯一索引 + `raw_answer` 比对实现。
- **不改动核心领域算法**：不改变 `packages/domain` 的掌握门槛、错因规则或 FSRS 调度公式。

## Capabilities

### New Capabilities
- `transactional-persistence`: 定义 M2-B 的短原子事务提交、`learning_progress` 版本 CAS、`submission_id` 唯一幂等去重、过期交互拒绝与领域事件审计落库行为（对应 NFR-02、NFR-03）。

### Modified Capabilities
- `local-storage`: 升级存储契约以支持 SQLite v5 迁移、原子短事务（`runInTransaction`）与 CAS 写入，保持 M1/M2-A 既有数据平滑无损升级。

## Impact

- **受影响包**：`packages/infra`（SQLite v5 迁移、`ExpoLearningStore`、`MemoryAppStore`）、`packages/app-host`（`StudyInteractions`、`MasterySessionService`、大纲工具与删除/重置流程）、`apps/mobile`（冲突/过期提交的轻量提示与投影刷新，UI 视觉以 `m2a-mobile-ux-polish` 完成后为准）。
- **前置依赖**：所有 M2-A Change、`refine-mobile-learning-experience` 与 `m2a-mobile-ux-polish` 均已归档，本 Change 可直接基于最新基线开始实施。
