# Proposal

## Why

Change 7 补齐了短事务、CAS 与幂等后，应用仍需在进程随时被系统强杀或断电时自动把跨表和跨会话状态对账到一致态，并证明所有异常切点（出题后、作答保存后未评分、评分提交后 UI 未刷新、流式回复中断、大纲预览过期）都可确定性恢复（NFR-04、AC-05）。同时，遗忘曲线调度对设备时钟跳变、跨天/时区切换与回拨非常敏感，需要系统化的 Host 故障注入测试套件与可控时钟复习回归保障（AC-06）。

## What Changes

- **冷启动全局状态对账服务（`packages/app-host`）**：
  - 新增 `RecoveryService`（在应用启动 `AppBootstrapService` 初始化时自动执行，只读/本地对账、绝不自动重发外部模型请求）：
    1. **流式回复对账**：扫描全库遗留 `status = "generating"` 的助手消息统一置为 `interrupted`，为缺失助手行的已提交用户消息补齐 `interrupted` 占位（覆盖问答、小老师与全部精通会话）。现状：`AppContext` 冷启动时已分别调用 `Lf01ChatService` 与 `MasterySessionService` 的 `recoverInterruptedTurns()` 逐会话修复；本 Change 将其收拢进 `RecoveryService` 单一入口与单个事务，并移除这两处旧调用；
    2. **题卡与评分对账**：核对每条 `interactions` 与 `learning_progress.learning_evidence` 及 `domain_events`——若 `interactions.status = "answered"` 但对应 `evidence_id` 均已落入 `learning_progress`（评分提交后强杀），自动将题卡纠偏为 `graded` 并补齐展示态，不重复计分；若确实尚未评分，保留 `answered` 原答案并在恢复后标记为可重试批改；
    3. **孤儿与并发状态清理**：确认单路径至多一条有效未结束题卡（若历史脏数据残留多条旧 `awaiting_input`，仅保留最新一条并将过期旧条标为 `abandoned`）；重启后失效的内存大纲预览返回明确提示引导重新预览，不破坏原大纲。
- **Host 故障注入测试套件（`packages/infra`、`packages/app-host`）**：
  - 新增可包装任意 `AppStore` 的 `FaultInjectingAppStore` 测试夹具（支持在指定写操作前/后、事务提交前/后注入精确故障，模拟进程崩溃），覆盖 AC-05 的全部关键切点：① 出题落库后中断；② 保存作答后、语义判定前/中中断；③ 评分事务提交后、UI 刷新前中断；④ 大纲修订提交冲突/中断；⑤ 重复提交相同/不同 `submission_id`；⑥ `mastery_repair_question` 作废重算中途故障回滚。
- **可控时钟与时间鲁棒性回归（`packages/domain`、`packages/app-host`）**：
  - 梳理并固化跨天、跨周、时区变化与**设备时钟回拨**（`now < last_review_at` 或 `now < updated_at`）时的调度与排序边界，防止出现负间隔、NaN 稳定度或遗忘风险越界；
  - 扩充可控时钟复习回归测试集，锁定多知识点交错到期、失误回落、五连对补救、提前结束与策略重排的可复算样本。
- **恢复态 UI 反馈对齐（`apps/mobile`）**：基于 `m2a-mobile-ux-polish` 完成后的学习首页、精通会话与题卡样式，确保强杀重启后「该做的事」准确反映待答/待重试评分状态，已保存未评分题卡一键可重试批改且不丢原答案。

### Non-Goals / Out of Scope
- **不重复实现短事务与 CAS 机制**（依赖 Change 7 已提供的 `runInTransaction`、`saveWithCas`、`interactions.submission_id` 唯一索引与 `domain_events`）。
- **不包含本地备份导出与恢复**（留给 Change 9 · `m2b-backup-and-restore`）。
- **不在冷启动时自动发起任何外部 LLM 请求**（遵循离线可用原则 NFR-01，待重试回复与待重试语义判定由用户显式触发）。

## Capabilities

### New Capabilities
- `crash-recovery`: 定义应用冷启动全局状态对账、异常恢复矩阵（覆盖流式中断、题卡/作答/评分三切点）、Host 故障注入验证以及设备时钟边界（跨天、时区与时钟回拨）的确定性行为（对应 NFR-04、AC-05、AC-06）。

### Modified Capabilities
（无；Change 7 已升级 `local-storage` 契约，本 Change 新增独立的 `crash-recovery` 能力规格，不修改已有规格。）

## Impact

- **受影响包**：`packages/domain`（时钟回拨安全边界测试与必要防护）、`packages/infra`（测试用 `FaultInjectingAppStore` 夹具，不入生产路径）、`packages/app-host`（`RecoveryService`、启动对账集成与故障注入/时钟回归测试套件）、`apps/mobile`（启动期触发 `recover()` 并对齐 `m2a-mobile-ux-polish` 后的恢复态提示）。
- **前置依赖**：Change 7（`m2b-transactions-and-idempotency`）验收归档后实施（M2-A 与 `m2a-mobile-ux-polish` 已归档）。
