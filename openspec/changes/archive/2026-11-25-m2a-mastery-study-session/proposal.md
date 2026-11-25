# Proposal

## Why

Change 3′ 建好了精通会话骨架与编辑大纲模式，但学习模式还不能出题、批改或推进掌握。DeepTutor 的学习模式里，导师以 `mastery_quiz` 出题并结束本轮，学习者在题卡上作答后作为下一条消息提交，引擎在导师开口前先批改，导师再据此回复；定性知识点由导师调用 `mastery_assess` 以学习者原话评估；学习者可在路径页查看证据并自报掌握。本 Change 交付这一套学习模式能力（AC-04），并建立复习模式（Change 5′）共用的题卡与评分管线。

## What Changes

- **评分管线（`packages/domain`）**：移植 DeepTutor `service.py` 的 `_apply_grade`、`record_quiz_attempt`、`record_qualitative_in_memory`、`set_learner_mastery_override` 与 `grading.classify_error`：
  - 定量：作答记录与错因记录（答错新建或追加重试、答对结业）、近 5 次有效独立作答重算掌握度（部分正确记 0.5）、从首次评分起驱动复习调度；
  - 定性：写入定性掌握标记、证据与评分依据，同样驱动调度；
  - 辅助作答不改变掌握结论，证据质量封顶 0.6；
  - 作废与更正题目后按剩余证据重算；
  - 自报掌握与撤销。
- **语义判定（`packages/runtime`）**：移植 `semantic_assessment.py` 的判定：选择题与可接受答案精确比对，其余用 DeepSeek Flash 输出结构化判定（正确 / 部分正确 / 错误 / 未评分、置信度、反馈、参考答案）；未评分或置信度低于 0.8 时不定分。
- **学习模式工具（`packages/app-host`）**：`mastery_quiz`（选择、简答、开放、题组 2–4 小题，选项打乱展示，出题即结束本轮）、`mastery_grade`、`mastery_assess`、`mastery_note_explained`、`mastery_defer_objective`、`mastery_skip_question`、`mastery_repair_question`；题卡提交作为下一条消息，Host 先保存答案、批改，再把结果注入本轮。
- **界面（`apps/mobile`）**：
  - 会话内题卡：字母选项、「用我自己的话回答」、文本输入、题组一次提交、「跳过」、批改结果（「正确 / 还差一点 / 部分正确 / 未评分，掌握状态不变」与解析）、「复核或申诉本次判定」，未定评分时保持可编辑；
  - 知识点达标时的升级庆祝；
  - 路径页完整版：知识点证据抽屉（掌握状态、门槛、作答原文、独立性、评分依据、错因）与自报掌握（「我已经掌握，直接放行」、「由你确认」、「回到正常测评」），以及学习档案卡。

### Out of Scope（本 Change 明确不做）
- 复习模式的出题范围限制、复习计划面板与复习入口（Change 5′）。
- 学习首页与交接卡（Change 6′）。
- 视觉题、资料页展示与资料曝光标记（P0 无资料页展示，管线保留辅助字段）、由模型进行的四类错因细分（沿用上游粗分类）。
- 看板视图、手工编辑模块。
- 原子事务、CAS、`submission_id` 严格幂等（D3，M2-B）；本 Change 以 `evidence_id` 去重防止简单重试重复计分。

## Capabilities

### New Capabilities
- `mastery-question-cards`: 出题工具、题卡类型与交互、作答即下一轮、跳过、复核、未定评分。
- `mastery-assessment`: Study 与 Review 共用的评分管线（精确与语义判定、定量门槛、定性评估、错因、辅助作答、作废与更正、路径状态）。
- `mastery-study-mode`: 学习模式中的导师行为支撑（下一个目标、讲解记录、延期、升级庆祝）。
- `mastery-objective-evidence`: 路径页证据抽屉、自报掌握与学习档案卡。

### Modified Capabilities
<!-- 无 -->

## Dependencies

- Change 3′ 已归档（精通会话、工具框架、`interactions` 的 `abandoned` 状态、路径页基础版）。

## Impact

- **`packages/domain`**：新增 `grading.ts`（`classifyError`、`recordQuizAttempt`、`applyGrade`、`recordQualitativeAssessment`、`voidAttempt`、`correctAnswerKey`、`setLearnerMasteryOverride`）与测试。
- **`packages/runtime`**：新增 `semantic-assessment.ts`（可注入 `fetch`），扩展 `register-question.ts` 以支持题组、可接受答案、解析与选项打乱。
- **`packages/infra`**：`InteractionStore.updateInteraction`（更新题卡内容或评分结果）。
- **`packages/app-host`**：`mastery/tools/` 新增 7 个工具；`session-service.ts` 增加题卡提交、回合开始批改、跳过与证据查询；测试。
- **`apps/mobile`**：会话页题卡组件 `src/components/mastery/QuestionCard.tsx`、升级庆祝组件、路径页证据抽屉与学习档案卡。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm test` 全绿；Android 真机完成新 AC-04。
