# Tasks

> 前置：阶段 0 的 V0.4 范围决策表已确认；任务 1.1 的小验证可与 Change 10 并行执行，小验证通过后再继续 1.2–3.1。

## 1. Pre-Implementation Quick-Check Verification & Runtime Generator (`packages/runtime`, `scripts`)

- [x] 1.1 在 `packages/runtime/src/quick-check.ts` 新增 `generateQuickCheck`（基于 `response_format: json_object` 生成 1–2 道选择/简答题，复用题卡校验与选项打乱），并新增 `scripts/s8-quick-check/run-verify.ts`（读取根目录 `.env`，严禁输出凭据）运行 10 组真实 DeepSeek Flash 问答上下文出题基准，核验合法率 ≥ 90%、题面/导语零答案泄露 100%、响应耗时 P50 ≤ 10 s / P90 ≤ 18 s，记录脱敏结论至 `docs/evaluation/s8-quick-check-report.md`。运行 `corepack pnpm --filter @learn-pace/runtime typecheck && corepack pnpm test`。
- [x] 1.2 在 `packages/runtime/src/__tests__/runtime.test.ts` 补齐 `generateQuickCheck` 单元测试（合法 JSON、选项打乱、非法选项/缺答案拒错、题数限制 1–2 题）。运行 `corepack pnpm --filter @learn-pace/runtime typecheck && corepack pnpm test`。

## 2. Host Quick-Check Lifecycle & Strict Mastery Isolation (`packages/app-host`)

- [x] 2.1 在 `packages/app-host/src/lf01-chat.ts`（或拆分 `chat-quick-check.ts`）实现 `createQuickCheck(sessionId, sourceMessageId?)`、`submitQuickCheck(sessionId, messageId, answers, submissionId)`、`retryQuickCheck(sessionId, messageId)` 与脱敏投影 `publicQuickCheck(message)`：结果仅写入 `messages.metadata.quick_check`（不写 `interactions`），复用精确比对与 `assessSemantically`，落实 `submission_id` 幂等与 `RestoreGate` 检查，并提供「转为学习目标」摘录载荷。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 2.2 新增 `packages/app-host/src/__tests__/chat-quick-check.test.ts`，覆盖：从助手消息与会话快捷入口生成 1–2 题、未判分投影不含答案与解析、选择题精确判定与简答语义判定、强杀后从 `messages` 恢复未答与已判自测卡、同 `submission_id` 重复提交不重复评分、同 ID 异作答被拒、**断言 `learning_progress`、`interactions` 与复习计划在自测前后完全零改动**，以及备份恢复后自测卡完整保留。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Mobile Quick-Check UI (`apps/mobile`)

- [x] 3.1 从 `apps/mobile/src/components/mastery/QuestionCard.tsx` 抽出可复用的选项/输入框/评分解析内部子部件，组合实现 `apps/mobile/src/components/QuickCheckCard.tsx`（含稳定 `submissionId`、提交/重试状态及判分后的「继续聊」「转为学习目标」操作）；在 `apps/mobile/src/components/ChatConversation.tsx` 接入回复底部「考考我」与输入框旁快捷入口。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Android ARM64 Physical Device Verification (AC-10)

- [x] 4.1 在 Android 真机（`86ceabbf`）完成 **AC-10** 验收：① 在问答完成两轮概念对话后，分别从助手消息「考考我」和输入框快捷入口触发自测，确认生成 1–2 题且判分前无答案泄露；② 未作答时执行 `adb shell am force-stop app.learnpace.m1` 并重启，确认原自测题仍完整可答；③ 提交作答并连点重试，确认正常评分且不重复计分；④ 检查学习首页、精通之路与路径页，确认既有掌握度与复习计划零变化；⑤ 分别点击「继续聊」与「转为学习目标」确认流转正常。结果追加至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `chat-quick-check` 同步为主规格。
