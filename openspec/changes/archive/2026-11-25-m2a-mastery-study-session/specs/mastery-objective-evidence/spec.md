# Spec Delta

## Purpose

定义路径页中的知识点证据抽屉、自报掌握与学习档案卡（对应 DeepTutor `ModuleOutline` 抽屉、`ObjectiveDetail`、`LearnerProfileCard` 与 `set_learner_mastery_override`）。

## ADDED Requirements

### Requirement: Objective evidence drawer
Tapping an objective in the path outline SHALL open a drawer showing its type, mastery status and source (system or 「由你确认」), gate and current score, attempts with original answers and independence, qualitative rationale and criteria met, error records, teaching records, and review summary, with an empty state when there is no evidence.

#### Scenario: Inspecting a practiced objective
- **WHEN** 用户点开一个答过两次题的知识点
- **THEN** 抽屉显示两次作答原文、是否独立、对错、当前得分与门槛

### Requirement: Learner self-reported mastery
For an objective that has not cleared its assessed gate, the drawer SHALL offer 「我已经掌握，直接放行」 with an optional reason up to 500 characters; confirming MUST mark it mastered with source learner, clear its deferral, and leave assessed evidence unchanged, and 「回到正常测评」 MUST remove the override.

#### Scenario: Self-reporting mastery
- **WHEN** 用户对一个未达标的知识点确认「确认已掌握」
- **THEN** 该知识点显示「由你确认」与「已由你标记为掌握；测评证据保持不变。」，进度与下一个目标按已掌握计算

#### Scenario: Returning to assessment
- **WHEN** 用户点「回到正常测评」
- **THEN** 自报掌握被移除，知识点恢复为原来的测评状态

### Requirement: Learner profile card
The path page SHALL show the learner profile saved by the tutor (prior knowledge, target level, time budget, preferences, teach-first or probe-first).

#### Scenario: Profile after outline intake
- **WHEN** 导师在编辑大纲会话中保存了学习档案
- **THEN** 路径页「学习档案」卡显示这些内容
