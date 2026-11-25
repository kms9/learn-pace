# mastery-topics Specification

## Purpose

定义精通之路的入口与路径管理（对应 DeepTutor `TopicAtlas`、`CreateTopicWizard` 与路径页）：路径列表、两步新建向导、路径页基础版、改名、重置进度与删除主题。

## Requirements

### Requirement: Mastery Path tab lists topics
The 精通之路 tab SHALL list all local mastery topics as cards showing emoji, name, and mastered-over-total progress (or 「去定大纲」 when the outline is empty), ordered by most recent update, with a 「新建精通目标」 action and an empty state when no topic exists.

#### Scenario: Viewing topics with and without outlines
- **WHEN** 本地有一条已有大纲的路径和一条刚创建、大纲为空的路径
- **THEN** 列表显示两张卡片，前者显示「已掌握 x / 共 y」，后者显示「去定大纲」，点击卡片进入路径页

### Requirement: Two-step creation wizard opens an outline session
The system SHALL create a topic through two steps (goal up to 2,000 characters plus emoji; optional materials from chat sessions, selections, or text notes, plus a read-only model summary), MUST create an empty path with a stable `path_id`, and SHALL open a new outline-mode session that automatically sends the opening message.

#### Scenario: Creating a topic without materials
- **WHEN** 用户填写目标、跳过资料并点「和导师一起定大纲」
- **THEN** 系统创建大纲为空的路径与一个编辑大纲模式的会话，进入会话并以学习者身份发送「用我选的资料，和我一起制定这个精通目标的大纲。」

#### Scenario: Creating a topic from a chat reply
- **WHEN** 用户从问答「转为学习目标」进入向导
- **THEN** 第二步已预选来源会话与选文，用户补充目标后创建的路径保存这些资料及其来源会话与消息 ID

#### Scenario: Goal is required
- **WHEN** 用户未填写目标就尝试进入第二步
- **THEN** 向导停留在第一步并提示需要填写目标

### Requirement: Path page overview
The path page SHALL show emoji and editable name, goal, up to five material chips, mastered-over-total progress, a 「下一个」 section using DeepTutor next-step copy with a primary action, the read-only outline, and the list of mastery sessions with the ability to resume one or start a new study session.

#### Scenario: Path without an outline
- **WHEN** 用户打开一条大纲为空的路径
- **THEN** 「下一个」区显示「和导师一起定大纲」，点击进入该路径的编辑大纲会话

#### Scenario: Resuming a session from the path page
- **WHEN** 路径有两个会话，用户点击其中一个
- **THEN** 应用打开该会话并保留其当前模式与全部消息

### Requirement: Reset progress and delete topic
The system SHALL offer 「重置进度」 and 「删除主题」 with confirmation; resetting MUST clear attempts, evidence, mastery, overrides, deferrals, review state, teaching records, and errors and abandon open question cards while keeping the outline, materials, goal, and learner profile; deleting MUST remove the path, its mastery sessions, messages, and question cards.

#### Scenario: Resetting progress keeps the outline
- **WHEN** 用户确认「重置进度」
- **THEN** 路径的大纲、资料与学习档案保留，所有知识点回到未学状态，进度显示为 0

#### Scenario: Deleting a topic
- **WHEN** 用户确认「删除主题」
- **THEN** 该路径及其会话从列表与存储中消失，问答会话不受影响
