# Spec Delta

## Purpose

定义精通会话中的题卡（对应 DeepTutor `mastery_quiz` 与 `MasteryQuestionCard`）：出题即结束本轮、题卡类型与交互、作答作为下一条消息先保存再批改、跳过、复核与未定评分。

## ADDED Requirements

### Requirement: Posting a question ends the turn
`mastery_quiz` SHALL be available only in study and review modes, SHALL validate the question (known knowledge point, at least two distinct choice options with a matching answer, no other open card on the path), MUST store the answer, accepted answers, and explanation privately, and MUST end the tutor turn once the card is stored.

#### Scenario: Choice question card
- **WHEN** 导师在学习模式写完引导语后调用 `mastery_quiz` 出一道四选一的题
- **THEN** 会话中出现题卡，选项打乱后标为 A–D，题卡不含答案与解析，本轮立即结束

#### Scenario: Second open card is refused
- **WHEN** 路径已有一张未结束的题卡时导师再次出题
- **THEN** 工具返回拒绝原因，不创建新题卡

### Requirement: Card types and answering
Question cards SHALL support choice (with 「用我自己的话回答」), short, open, and group questions (2–4 sub-questions submitted together), and submitting MUST send the answer as the learner's next message while sending is blocked during generation.

#### Scenario: Answering a group question
- **WHEN** 学习者在题组卡中填写全部小题并点「提交」
- **THEN** 系统以一条学习者消息发送全部作答，并开始批改

### Requirement: Answer saved and graded before the tutor replies
On card submission the system SHALL save the raw answer first, grade it, show the result on the card, and include the result in the turn context before the tutor replies; a grading failure MUST keep the saved answer retryable without recording evidence.

#### Scenario: Card shows the grade before the tutor speaks
- **WHEN** 学习者提交选择题作答
- **THEN** 题卡先显示「正确」或「还差一点」与解析，随后导师结合批改结果回复

#### Scenario: Grading failure
- **WHEN** 语义判定因网络错误失败
- **THEN** 原答案保持已保存状态，题卡显示可重试，不产生任何证据

### Requirement: Undecided grades, skip, and challenge
An undecided grade (ungraded or confidence below 0.8) SHALL leave the card editable with the saved answer and MUST NOT change mastery; the learner SHALL be able to skip an open card, which abandons it and sends 「跳过这道题吧。」; and the learner SHALL be able to send a challenge from a graded card through 「复核或申诉本次判定」.

#### Scenario: Undecided short answer
- **WHEN** 学习者的简答作答语义判定置信度为 0.6
- **THEN** 题卡显示「未评分，掌握状态不变」并保持可编辑，导师追问澄清

#### Scenario: Skipping a question
- **WHEN** 学习者点「跳过」
- **THEN** 题卡标记为已放弃，会话中出现「跳过这道题吧。」，不记录作答

### Requirement: Card recovery after restart
Open and graded question cards SHALL be restored from local interactions after the app restarts, without generating a new question.

#### Scenario: Restoring an open card
- **WHEN** 题卡待答时应用被强杀并重新打开该会话
- **THEN** 同一张题卡恢复为可作答状态
