# Design

## Context

参见 `proposal.md`、`docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md` §3.7–3.10 与 `docs/prd/04-lf02-mastery-flow.md`。本 Change 建立在 Change 3′ 的精通会话、工具框架、状态快照与提示词之上。

DeepTutor 参照（`upstream/deeptutor`）：
- 工具：`deeptutor/capabilities/mastery/tools.py` 的 `mastery_quiz`（第 1132 行起，出题即结束本轮、选项打乱、题组）、`mastery_grade`（第 1688 行起）、`mastery_assess`（第 2065 行起，取学习者本轮原话，忽略 `passed`）、`mastery_note_explained`（第 960 行起）、`mastery_skip_question`、`mastery_repair_question`（第 2266 行起）、`mastery_defer_objective`。
- 作答时序：`deeptutor/services/session/turns/learning_adapter.py`（先保存答案，导师开口前批改）、`loop.py` 第 463–628 行（批改结果作为本轮种子）。
- 评分：`deeptutor/learning/service.py` 的 `record_quiz_attempt`（第 474 行起）、`calculate_mastery`、`_apply_grade`（第 580 行起）、`record_qualitative_in_memory`（第 2919 行起）、`set_learner_mastery_override`（第 2290 行起）；`semantic_assessment.py`（`Verdict`、`exact_verdict`、`final` 规则）；`grading.classify_error`。
- 界面：`web/components/chat/home/MasteryQuestionCard.tsx`、`web/lib/mastery-question.ts`、`LevelUpCelebration.tsx`、`ModuleOutline.tsx` 第 194–345 行（证据抽屉与自报掌握）、`ObjectiveDetail.tsx`、`LearnerProfileCard.tsx`；文案 `web/locales/zh/app.json`。

## Goals / Non-Goals

**Goals:**
- 学习模式的出题、作答、批改、定性评估与证据查看在行为与文案上与 DeepTutor 一致。
- 评分管线成为 Study 与 Review 唯一的掌握、证据、错因与调度写入入口。

**Non-Goals:**
- 复习模式特有规则（Change 5′）；资料页曝光与视觉题；事务与 CAS（D3）。

## Decisions

### 1. 出题工具 `mastery_quiz`
- 只在学习、复习模式可用；参数：`knowledge_point_id`、`question`（题干）、`question_type`（`choice` / `short` / `open` / `group`）、`options`（选择题选项正文）、`expected_answer`（选择题为正确选项正文）、`accepted_answers`、`explanation`（批改后才展示）、`questions`（题组 2–4 小题，各自带上述字段）。
- 校验：知识点存在于大纲；选择题至少 2 个互不相同的选项且答案匹配其中之一；同一路径已有未结束题卡时拒绝。选项打乱后按 A、B、C… 标注，答案内部存为标签（同上游）。
- 题卡存入 `interactions`（`awaiting_input`），会话的 `session_id` 绑定；公开题卡不含答案、可接受答案与解析。工具返回后通过 Change 3′ 扩展的通用工具回合终止机制立即结束本轮，且保留出题前已流式输出给学习者的引导语。
- 题卡持久化与恢复扩展（`InteractionStore`）：
  - 新增 `listInteractionsBySession(sessionId)`，使会话打开与强杀重启后能完整恢复该会话内所有待答与已批改题卡；
  - 新增 `updateInteraction(interaction)`，支持未定评分时把题卡状态从 `answered` 退回 `awaiting_input` 并保留已填答案、支持题组部分作答/全部作答（单题存字符串，题组将 `Record<string, string>` JSON 序列化存入 `raw_answer`）以及更正答案后的题卡更新；
  - 批改结果快照（`result`、`feedback`、`reference_answer`、题组每小题判定）持久化在关联作答消息的 `metadata.mastery_grade`（或随 `interactions` 记录读取），确保强杀重启后已批改题卡的状态与解析可原样恢复。

### 2. 作答即下一轮、先保存再批改
- 题卡提交以学习者消息发出：消息正文为作答的可读文本（选择题为「B. 选项正文」，自由作答为原文，题组按小题列出），`metadata.mastery_answer = { interaction_id, answers }`。
- 本轮开始前 Host 依次：保存原答案（`answered`）→ 批改（决策 3）→ 若结果为定论，调用评分管线写入并把题卡标为 `graded`；若未定，题卡回到 `awaiting_input` 并保留已填答案 → 把批改结果放入本轮状态快照的 `pending_interaction` 与一段「学习者刚提交了作答，引擎批改结果如下」的说明 → 导师回复。题卡上的结果在批改完成后立即显示，不等导师回复。
- 学习者不用题卡、直接在输入框作答时，导师可在本轮调用 `mastery_grade`（可省略 `question_id`，批改当前未结束的题；题组可只传部分小题答案，返回 `complete` 与 `remaining_question_ids`）。
- 普通追问、异议不视为作答（同上游 `runtime_policy`）。

### 3. 批改：精确比对与语义判定
- 精确比对（同上游 `exact_verdict`）：空答为未评分；选择题按 `resolveChoiceSubmission` 解析为标签，能解析则判对错，不能解析为未评分（「请选择一个明确的选项」）；其他题型在去空白、忽略大小写后与答案或可接受答案相同即判对。
- 其余情况调用 `runtime` 的语义判定（`semantic-assessment.ts`）：请求 DeepSeek Flash 输出 JSON `{ result: correct | partial | incorrect | ungraded, confidence: 0–1, feedback, reference_answer?, criteria_met?: string[] }`，输入为题目契约（题干、类型、答案、解析、可接受答案、选项）或定性评估标准与学习者作答，作为数据传入；其中 `criteria_met` 供 `mastery_assess` 写入 `assessment_evidence[evidence_id]`。判定为定论的条件是 `result ≠ ungraded` 且 `confidence ≥ 0.8`，否则按未评分处理（「未评分，掌握状态不变」），由导师澄清。
- 语义判定失败（网络、格式）时保持 `answered`，题卡显示可重试；导师本轮说明批改未完成。

### 4. 评分管线（`packages/domain/src/grading.ts`）
- `classifyError(answer)`：空答 `metacognitive`，其余 `application`。
- `recordQuizAttempt`：答错且有错因时，对同一题与知识点已有错因记录追加失败重试并标 `retrying`，否则新建 `active`；答对时把对应 `active` / `retrying` 记录追加成功重试并标 `graduated`；最后追加作答。
- `applyGrade(progress, input, scheduler, now)`，对应上游 `_apply_grade`：
  1. 判定结果来自决策 3；`retrying` = 该题存在 `active` / `retrying` 错因；`alreadyScheduled` = 知识点已有复习状态；
  2. 记录作答（`independent = !assistance_used`，答错时带错因），移除该知识点的延期标记；
  3. 写证据：`evidence_id = interaction_id`（题组为 `interaction_id:question_id`），已存在则跳过；`assessment_type = alreadyScheduled ? "review" : "quiz"`；`quality` 为正确 `retrying ? 0.6 : 1.0`、部分正确 0.5、错误 0；有辅助且答对时封顶 0.6；
  4. `mastery_levels[kp] = computeMastery(该知识点未作废且独立的作答，部分正确记 0.5)`；
  5. 取已有复习状态或初始化，`scheduleReview`，重建复习队列。
- `recordQualitativeAssessment`，对应上游 `record_qualitative_in_memory`：`evidence_id` 由会话、回合、知识点确定，已存在则跳过；无辅助时写 `qualitative_mastery[kp] = (result === "correct")`，`mastery_levels[kp]` 通过时取 `max(当前, 1)`、不通过取 `min(当前, 0.4)`，通过时写 `feynman_explanations[kp]`；有辅助时不改变定性标记与掌握度（Learn Pace 规则，与定量辅助作答不计入对称）；移除延期；写 `assessment_type = "qualitative"` 证据（质量 正确 1 / 部分 0.5 / 错误 0，辅助答对封顶 0.6，`feedback` 为依据）；在 `assessment_evidence[evidence_id]` 保存满足的标准、模型 ID、置信度、是否辅助；初始化或更新复习状态。
- `voidAttempt` 与 `correctAnswerKey`：作废题目时将其作答标为 `voided` 并记录原因，删除对应证据与错因，按该知识点剩余证据用 `scheduler.replay` 重建复习状态，并重算掌握度；更正答案时写入新答案并对已保存作答重新批改后重算。
- `setLearnerMasteryOverride(progress, kp, mastered, note)`：设置时写入 `learner_mastery_overrides[kp] = { note（≤500 字）, created_at }` 并移除延期；撤销时删除。不写证据、不改复习状态。
- 每次写入后按 Change 3′ 的 `derivePathStatus` 更新路径状态。M2-A 顺序落库：保存答案 → 批改 → 写进度 → 标记题卡，`evidence_id` 防止重复计分。

### 5. 定性评估 `mastery_assess`
- 只在学习、复习模式、且只对 `concept` / `design` 知识点可用；参数只有 `knowledge_point_id`，模型传入的 `passed` 被忽略。
- 评估对象是学习者本轮消息原文（若本轮是题卡作答，即作答原文）。用语义判定评估，标准为知识点名称、模块目标与导师在出题时给出的解析（若有）。不定论时不写入，返回需要澄清；同一知识点后续轮次的补充说明与之前的待定说明合并再评估（同上游 `service.py` 第 3107–3177 行）。定论时调用 `recordQualitativeAssessment`，返回 `mastered` 与反馈。

### 6. 其他学习工具
- `mastery_note_explained`：参数 `knowledge_point_id`、`summary`、`explanation_quote`。引文必须出现在本轮已展示给学习者的导师文本中，否则拒绝；写入 `explained_objectives[kp] = { coverage: "partial", summary, explanation_quote, delivery: { session_id, turn_id } }`，不影响掌握。
- `mastery_defer_objective`：写入 `deferred_objectives[kp]`；下一个目标按官方 `nextObjective` 先跳过延期项。
- `mastery_skip_question`：放弃当前未结束题卡（`abandoned`）。题卡上的「跳过」按钮由 Host 直接放弃并以学习者身份发送「跳过这道题吧。」。
- `mastery_repair_question`：`action = void | correct`、`reason`、`question_id`（默认当前或最近一题）、`expected_answer`（更正时必填，选择题传选项正文）；调用决策 4 的作废或更正。题卡上的「复核或申诉本次判定」以学习者身份发送一条申诉消息，由导师判断是否调用该工具。
- 下一个目标：使用已移植的官方 `nextObjective`（待答题 → 到期复习 → 按模块顺序的第一个未掌握目标，跳过延期，不拦先修）；Host 以 `interactions` 表中的未结束题卡作为 `answer_pending`。

### 7. 界面
- 题卡组件（会话消息流中，紧跟出题的导师消息）：
  - 选择题：字母选项，可选「用我自己的话回答」展开文本框；简答 / 开放：文本框；题组：2–4 个小题卡，一个「提交」。
  - 「跳过」；提交中、生成中、会话加载中不可提交。
  - 批改后：边框与标题显示「正确」「还差一点」「部分正确」或「未评分，掌握状态不变」，答错时标出正确选项，展示解析（`MessageContent`）；「复核或申诉本次判定」。
  - 未定评分：题卡保持可编辑并保留已填内容。
  - 强杀重启后按 `interactions` 恢复待答或已批改的题卡。
- 升级庆祝：回合结束刷新路径后，若有知识点从未掌握变为已掌握，播放全屏庆祝动画并显示知识点名称；系统开启「减少动态效果」时只显示静态提示。
- 路径页完整版：
  - 大纲中点击知识点打开证据抽屉：类型、掌握状态与来源（系统 / 「由你确认」）、门槛与当前得分、作答记录（原文、是否独立、对错）、定性评估依据与满足的标准、错因记录、讲解记录、复习状态摘要；无证据时显示空态。
  - 未经测评达标的知识点显示「我已经掌握，直接放行」→ 填写「可选：为什么跳过这一项？」（≤500 字）→「确认已掌握」；已自报时显示「已由你标记为掌握；测评证据保持不变。」与「回到正常测评」。
  - 学习档案卡：展示 `learner_profile`（已有基础、目标程度、时间、偏好、先探查或先讲解）。

## Risks / Trade-offs

- **[Risk] 语义判定依赖模型输出 JSON** → Mitigation：先保存答案，判定失败保持可重试；置信度不足按未评分处理，不产生通过证据。
- **[Risk] 作废与更正题目在顺序落库下可能留下中间状态** → Mitigation：先写进度再改题卡状态，按 `evidence_id` 幂等；M2-B Change 7 改为原子事务。
- **[Risk] 自报掌握会让路径显示「已完成」而无测评证据** → Mitigation：与上游一致；界面以「由你确认」区分来源，证据抽屉保留原测评状态。
- **[Risk] P0 没有辅助作答的产生来源** → Mitigation：管线保留 `assistance_used` 与质量封顶规则，资料页展示在后续版本接入时直接生效。
