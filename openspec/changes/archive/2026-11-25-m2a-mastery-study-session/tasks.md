# Tasks

> 前置：Change 3′ 已归档。

## 1. Grading Pipeline (`packages/domain`)

- [x] 1.1 新增 `packages/domain/src/grading.ts`，按 design 决策 4 移植 `classifyError`、`recordQuizAttempt`、`applyGrade`、`recordQualitativeAssessment`、`voidAttempt`、`correctAnswerKey`、`setLearnerMasteryOverride`，在 `index.ts` 导出；保持纯 TS。运行 `corepack pnpm --filter @learn-pace/domain typecheck`。
- [x] 1.2 新增 `packages/domain/src/__tests__/grading.test.ts`，参照 `upstream/deeptutor/deeptutor/learning/tests/test_guided_mastery_updates.py` 等移植用例：错因新建、重试、结业；独立 1/2/3 次答对得 0.5/0.8/1.0；部分正确记 0.5；已调度后证据为 `review`；重试中的错题答对质量 0.6；辅助作答不计入且封顶 0.6；同会话连续答对不提升稳定度；定性通过、部分、辅助三种结果；相同 `evidence_id` 不重复计分；作废后按剩余证据重算；更正答案后重新批改；自报掌握与撤销；路径状态推导。运行 `corepack pnpm test`。

## 2. Semantic Assessment & Question Validation (`packages/runtime`)

- [x] 2.1 新增 `packages/runtime/src/semantic-assessment.ts`（可注入 `fetch`）：`exactVerdict` 与模型判定，输出 `{ result, confidence, feedback, reference_answer?, criteria_met? }` 与 `final` 规则；扩展 `register-question.ts` 支持 `short` / `open` / `group`、`accepted_answers`、`explanation` 与选项打乱。在 `runtime.test.ts` 覆盖精确比对、置信度阈值、`criteria_met` 透传、非法 JSON、题组校验与公开题卡不泄露答案。运行 `corepack pnpm --filter @learn-pace/runtime typecheck && corepack pnpm test`。

## 3. Study Tools & Turn Flow (`packages/infra`, `packages/app-host`)

- [x] 3.1 `packages/infra`：`InteractionStore` 增加 `listInteractionsBySession(sessionId)` 与 `updateInteraction`（支持未定评分 `answered → awaiting_input` 回退并保留已填答案、题组答案 JSON 编码、更正答案后更新题卡），内存与 Expo 实现及测试。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [x] 3.2 在 `packages/app-host/src/mastery/tools/` 新增 `mastery_quiz`、`mastery_grade`、`mastery_assess`、`mastery_note_explained`、`mastery_defer_objective`、`mastery_skip_question`、`mastery_repair_question`（按模式校验，参数与行为按 design 决策 1、5、6）；在 `session-service.ts` 增加题卡提交（先保存、批改、写入、注入本轮）、题卡跳过、申诉消息、`answer_pending` 覆盖、证据查询 `objectiveEvidence` 与自报掌握命令。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 3.3 新增 `packages/app-host/src/__tests__/mastery-study.test.ts`（脚本化模拟网关）：出题结束本轮且题卡不含答案、已有题卡时拒绝出题、编辑大纲模式下调用学习工具被拒、选择题提交先显示结果再由导师回复、未定评分保持可编辑、批改失败可重试、题组部分作答、定性评估取学习者原话并忽略 `passed`、待定说明合并、讲解引文校验、延期与回退、跳过、作废与更正、自报掌握对下一个目标与路径状态的影响、强杀后题卡恢复。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. UI (`apps/mobile`)

- [x] 4.1 新增 `apps/mobile/src/components/mastery/QuestionCard.tsx` 并接入会话页：选择（含「用我自己的话回答」）、简答、开放、题组；「跳过」；批改结果文案与解析（`MessageContent`）；「复核或申诉本次判定」；未定评分可编辑；生成中禁用提交。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.2 新增升级庆祝组件（遵循「减少动态效果」），在回合结束刷新后检测新掌握的知识点。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.3 `apps/mobile/app/mastery/[pathId]/index.tsx`：知识点证据抽屉（底部弹层）、自报掌握与撤销（文案按 DeepTutor）、「学习档案」卡。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 5. Android ARM64 Physical Device Verification (AC-04)

- [x] 5.1 在 Android 真机（`86ceabbf`）完成新 **AC-04**：对一个 `procedure` / `memory` 知识点连续独立答对三次观察 50% → 80% → 100% 与升级庆祝；答错一次并在证据抽屉看到错因；完成一道简答或题组；对一个 `concept` 知识点用自己的话解释并由导师评估；跳过一题与申诉一次；对另一个知识点自报掌握后撤销；题卡待答时强杀重启确认恢复。记录批改与导师回复延迟，追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将四个能力同步为主规格。
