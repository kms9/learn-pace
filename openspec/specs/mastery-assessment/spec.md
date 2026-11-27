# mastery-assessment Specification

## Purpose

定义 Study 与 Review 共用的评分管线（移植 DeepTutor `_apply_grade`、`record_quiz_attempt`、`record_qualitative_in_memory`、`semantic_assessment`）：精确与语义判定、定量掌握门槛、定性评估、错因记录、辅助作答、作废与更正，以及路径状态。

## Requirements

### Requirement: Exact and semantic grading
The grader SHALL decide choice answers by resolving a unique option and other answers by case-insensitive match against the answer or accepted answers, and otherwise SHALL use a structured model judgment that is final only when its result is not ungraded and its confidence is at least 0.8.

#### Scenario: Unambiguous choice answer
- **WHEN** 学习者对选择题作答「我选 B」
- **THEN** 判定解析为选项 B 并直接判对错，不调用模型

#### Scenario: Low-confidence semantic judgment
- **WHEN** 语义判定返回 `partial`，置信度 0.7
- **THEN** 结果按未评分处理，不写作答记录与证据

### Requirement: Quantitative mastery gate
For each graded answer the system SHALL record the attempt and evidence (`assessment_type` quiz before scheduling, review after), recompute mastery from the last five non-voided independent attempts with recency weights and 1-attempt 0.5 / 2-attempt 0.8 caps (partial counts 0.5), and schedule review from the first graded answer; memory and procedure objectives clear the gate at 0.9.

#### Scenario: Three independent correct answers
- **WHEN** 学习者在同一会话中对一个 `procedure` 知识点连续独立答对三次
- **THEN** 掌握度依次不超过 50%、不超过 80%，第三次后达到 100% 并通过门槛；同一会话内后两次答对不提升复习稳定度

#### Scenario: Wrong answer records an error
- **WHEN** 学习者答错一道题，之后又答对同一道题
- **THEN** 答错时生成错因记录，答对时该记录标为已结业

### Requirement: Qualitative assessment from the learner's own words
`mastery_assess` SHALL be available only in study and review modes for concept and design objectives, MUST evaluate the learner's own message from that turn while ignoring any model-supplied pass flag, MUST merge follow-up explanations while the judgment is undecided, and on a final result SHALL set or clear the qualitative gate and record the response, rationale, criteria met, and model.

#### Scenario: Concept explanation passes
- **WHEN** 学习者用自己的话解释概念，导师调用 `mastery_assess`，判定为 `correct` 且置信度 0.9
- **THEN** 该知识点通过定性门槛，证据包含学习者原话、依据、满足的标准与模型

#### Scenario: Partial explanation keeps learning
- **WHEN** 判定为 `partial` 且为定论
- **THEN** 定性标记为未通过，导师继续讲解与追问

### Requirement: Assisted answers preserve the mastery conclusion
An answer marked as assisted MUST NOT count toward quantitative mastery and MUST NOT set or clear the qualitative gate, while its evidence quality SHALL be capped at 0.6.

#### Scenario: Assisted correct answer
- **WHEN** 一道带辅助标记的题被答对
- **THEN** 掌握度与定性标记不变，证据质量不高于 0.6

### Requirement: Voiding and correcting questions
`mastery_repair_question` SHALL void a question (marking its attempts voided, removing its evidence and errors, and rebuilding the objective's mastery and review state from the remaining evidence) or correct its answer key and re-grade the saved answer.

#### Scenario: Voiding a wrong question
- **WHEN** 学习者指出题目有误，导师以 `void` 作废该题
- **THEN** 该题的作答不再计入掌握度，知识点掌握度与复习状态按剩余证据重算

### Requirement: Path status follows mastery
After every grade, override, void, or correction the system SHALL set the path to completed when every objective is mastered (assessed or self-reported) and to active otherwise.

#### Scenario: Completing and reopening a path
- **WHEN** 最后一个未掌握的知识点通过门槛，之后又有一个知识点因新的评分不再满足门槛
- **THEN** 路径先变为已完成，再回到学习中
