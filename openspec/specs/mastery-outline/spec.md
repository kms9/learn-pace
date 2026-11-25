# mastery-outline Specification

## Purpose

定义编辑大纲模式（对应 DeepTutor `session.outline`、`mastery_build`、`mastery_revise`）：导师了解学习者并保存学习档案、建出大纲并保持知识点身份、直接修改或预览后提交修订、先修关系校验，以及大纲弹层与「大纲已就绪」提示。

## Requirements

### Requirement: Learner profile captured by the tutor
The tutor SHALL be able to save the learner profile (prior knowledge, target level, time budget, preferences, teaching strategy probe-first or teach-first, notes) through `mastery_profile`, merging with existing values.

#### Scenario: Saving what the learner already knows
- **WHEN** 学习者在编辑大纲会话中说明自己已有的基础与想达到的程度
- **THEN** 导师调用 `mastery_profile` 保存，路径的学习档案包含这些内容

### Requirement: Building an outline with stable objective identity
`mastery_build` SHALL create or replace the outline from modules and knowledge points (name, type memory/concept/procedure/design, prerequisites, source references) only in outline mode; on replace, knowledge points whose trimmed case-insensitive name and type uniquely match an existing one MUST keep its ID and progress.

#### Scenario: First outline unlocks study
- **WHEN** 导师在空路径的编辑大纲会话中调用 `mastery_build` 建出大纲
- **THEN** 路径状态从无大纲变为学习中，会话显示「大纲已就绪——共 N 个知识点」与「开始学习」

#### Scenario: Replacing an outline keeps matching objectives
- **WHEN** 已有大纲中的知识点「比例的化简」（procedure）已有作答记录，导师整体替换大纲且新大纲仍含同名同类型知识点
- **THEN** 该知识点沿用原 ID 与作答记录

### Requirement: Prerequisite and source validation
Every outline write SHALL be validated before persistence, rejecting duplicate IDs, self-prerequisites, unknown prerequisites, prerequisite cycles, and references to unknown or goal sources, and the rejection reason MUST be returned to the tutor without changing the outline.

#### Scenario: Rejecting a cyclic prerequisite graph
- **WHEN** 导师提交的大纲中 A 依赖 B、B 又依赖 A
- **THEN** 工具返回先修环路错误（含环路链路），大纲保持不变

### Requirement: Revising an outline directly or through preview and commit
`mastery_revise` SHALL apply small module edits immediately or create a preview tied to the session and current path revision that expires after one hour; committing MUST accept only a `preview_id` and MUST be refused when the preview is expired, belongs to another session, or the path changed since the preview.

#### Scenario: Committing a fresh preview
- **WHEN** 导师预览一次多模块修订并在下一轮用该 `preview_id` 提交，期间大纲未变化
- **THEN** 修订生效，`path_revision` 加 1，重排的模块保持知识点 ID 与进度

#### Scenario: Stale preview is refused
- **WHEN** 预览之后大纲已被另一次修改改变，导师仍用旧 `preview_id` 提交
- **THEN** 提交被拒绝并要求重新预览，大纲保持当前版本

### Requirement: Outline sheet in the session
The session SHALL provide an outline sheet showing modules, knowledge points, types, and prerequisites that refreshes after outline tools complete and highlights the current objective.

#### Scenario: Live outline refresh
- **WHEN** 导师在本轮调用 `mastery_revise` 修改了一个模块
- **THEN** 打开大纲弹层即可看到修改后的模块与知识点
