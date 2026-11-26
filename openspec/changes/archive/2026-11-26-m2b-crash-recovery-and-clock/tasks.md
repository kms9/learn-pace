# Tasks

> 前置：Change 7（`m2b-transactions-and-idempotency`）已验收归档（M2-A 与 `m2a-mobile-ux-polish` 均已归档）。

## 1. Global Startup & Group-Card Reconciliation (`packages/infra`, `packages/app-host`)

- [x] 1.1 在 `packages/infra/src/{index,memory,expo}.ts` 为 `InteractionStore` 新增 `listOpenInteractions()`（返回全库所有 `status IN ('awaiting_input', 'answered')` 题卡），补齐内存与 SQLite 实现及测试。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [x] 1.2 新增 `packages/app-host/src/recovery.ts` 实现 `RecoveryService`（提供 `reconcileInTransaction(tx)` 供 Change 9 事务复用，以及 `reconcileAll()`）：① 将 `ChatTurns.recover` 判定逻辑抽为纯函数，在 `tx` 上对全会话遗留 `generating` 与孤儿用户消息纠偏为 `interrupted`，并移除 `Lf01ChatService` 与 `MasterySessionService` 上旧的 `recoverInterruptedTurns()`（相关旧测试迁移至 `crash-recovery.test.ts`）；② 经 `tx.listOpenInteractions()` 对每张非关闭题卡先逐小题核对 `learning_evidence` 恢复已计分小题展示态，再判定整卡状态（全齐→`graded`、部分已评其余未填→`awaiting_input`、有已填未评→`answered`）；③ 最后按进度权重（`answered` > 部分已评/已填 `awaiting_input` > 空白 `awaiting_input`）与 `(updated_at DESC, interaction_id DESC)` 清理同路径多余未结束题卡为 `abandoned`；全程零网络调用。在 `AppBootstrapService` 暴露 `recoverOnStartup()`。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。

## 2. Fault-Injection Suite (`packages/infra`, `packages/app-host`)

- [x] 2.1 在 `packages/infra/src/testing/fault-store.ts` 新增测试专用 `FaultInjectingAppStore` 包装器（支持在写操作前后与事务提交前注入 `InjectedCrashError`）。运行 `corepack pnpm --filter @learn-pace/infra typecheck`。
- [x] 2.2 新增 `packages/app-host/src/__tests__/crash-recovery.test.ts`，用全新服务实例模拟强杀重启，覆盖：出题后崩溃、作答保存后语义判定前/中崩溃、评分提交后 UI 刷新前崩溃、历史单题 `answered`+已有证据纠偏为 `graded`、历史 3 小题题组 1 题已评 2 题待答保持 `awaiting_input`、同路径保留已保存答案旧卡并放弃空白重复卡、大纲预览重启失效、`mastery_repair_question` 失败回滚及 `recoverOnStartup()` 多次调用幂等。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Clock Skew Samples & Multi-Day Review Regression (`packages/domain`, `packages/app-host`)

- [x] 3.1 核查 `packages/domain/src/scheduler.ts` 与 `packages/app-host/src/mastery/review.ts` 的回拨边界并补充 `packages/domain` 单测：明确验证回拨期间「只浏览」（`forgetting_risk = 0`、不虚增到期数、不改写磁盘时间戳）与「实际提交评分」（答对命中同会话分支不改 `next_review_at`/`stability`/`lapse_count`；独立答错以 `max(now, last_review_at)` 计算缩短间隔并递增 `lapse_count`，零 `NaN`、零负间隔）。运行 `corepack pnpm --filter @learn-pace/domain typecheck && corepack pnpm test`。
- [x] 3.2 新增 `packages/app-host/src/__tests__/clock-review-regression.test.ts`，以可控 `FakeClock` 锁定跨 30 天样本：多知识点交错到期、同会话防刷、答错回落、五连对补救、策略与保持目标重排，以及回拨 -2 天只浏览 / 提交答对 / 提交答错后再恢复正常时钟的完整回归断言。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Mobile Startup Hook & Device Verification (AC-05 & AC-06)

- [x] 4.1 在 `apps/mobile/src/context/AppContext.tsx` 冷启动阶段接入 `service.recoverOnStartup()` 并移除原有的 `chat.recoverInterruptedTurns()` 与 `mastery.recoverInterruptedTurns()` 调用；核对学习首页「该做的事」与精通会话题卡对 `answered`（待重试评分）、部分完成题组与 `interrupted` 状态的展示与一键重试交互。运行 `corepack pnpm typecheck && corepack pnpm test`。
- [x] 4.2 在 Android 真机（`86ceabbf`）完整验收 **AC-05** 与可控时钟 **AC-06** 回归：分别在「出题后」「作答已保存但断网/判定前」「评分完成后」三个时点执行 `adb shell am force-stop app.learnpace.m1` 并重启，确认无重复计分、原题/原答案准确恢复、首页与会话数字一致；复测开发时钟前推与回调期间浏览及提交评分均无异常。结果追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `crash-recovery` 同步为主规格，随后进入 Change 9（`m2b-backup-and-restore`）。
