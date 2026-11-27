# mastery-study-mode Specification

## Purpose

定义学习模式中支撑导师教学的规则（对应 DeepTutor `session.study` 与相关工具）：下一个目标、讲解记录、延期，以及知识点达标时的升级庆祝。

## Requirements

### Requirement: Next objective follows DeepTutor policy
The status snapshot's next objective SHALL follow DeepTutor `next_objective`: an open card first, then due reviews, then the first unmastered non-deferred objective in module order (falling back to deferred ones), without enforcing prerequisites, and SHALL choose probe or teach for new objectives by the learner's teaching strategy.

#### Scenario: Prerequisites are advisory
- **WHEN** 大纲中排在前面的知识点 B 以 A 为先修，A 尚未掌握
- **THEN** 下一个目标仍按模块顺序给出 B，先修关系随大纲提供给导师参考

#### Scenario: Teach-first strategy
- **WHEN** 学习档案的教学偏好为先讲解，下一个目标是新知识点
- **THEN** 快照中的动作是 `teach`，路径页「下一个」显示「先讲解这个知识点，再检查你是否理解」

### Requirement: Recording delivered teaching
`mastery_note_explained` SHALL record partial coverage for an objective only when its quote appears in tutor text already shown to the learner in the current turn, and MUST NOT affect mastery.

#### Scenario: Quote not shown to the learner
- **WHEN** 导师调用 `mastery_note_explained`，引文不在本轮已展示的回复中
- **THEN** 工具拒绝记录并说明原因

### Requirement: Deferring an objective
`mastery_defer_objective` SHALL mark an unmastered objective as deferred so the next objective moves on, MUST NOT count it as mastered, and any later graded answer or self-report for it MUST clear the deferral.

#### Scenario: Deferral is not completion
- **WHEN** 路径只剩一个被延期的未掌握知识点
- **THEN** 路径不显示已完成，下一个目标回到该知识点

### Requirement: Level-up celebration
When a turn ends and an objective changed from unmastered to mastered, the session SHALL show a celebration naming the objective, and MUST show a static notice instead when the system reduce-motion setting is on.

#### Scenario: Objective mastered during the turn
- **WHEN** 学习者的作答使一个知识点通过门槛
- **THEN** 会话播放升级庆祝并显示该知识点名称
