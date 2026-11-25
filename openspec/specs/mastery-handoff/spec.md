# mastery-handoff Specification

## Purpose

定义问答中通往精通之路的只读导航工具与交接卡（对应 DeepTutor `mastery_nav.py` 与 `MasteryHandoffCard`）。

## Requirements

### Requirement: Read-only mastery navigation tools in chat
问答会话 SHALL 向导师提供 `mastery_topics`、`mastery_sessions`、`mastery_open_session` 和 `mastery_new_session`。这些工具 MUST NOT 修改任何学习数据或自行跳转。

#### Scenario: Listing topics from chat
- **WHEN** 学习者在问答中问「我之前学的比例那条路学到哪了」
- **THEN** 导师可调用 `mastery_topics` 读取路径与进度，回答中不改变任何学习数据

### Requirement: Handoff cards
导师调用 `mastery_open_session` 或 `mastery_new_session` 时，回复 SHALL 显示交接卡，包含路径、可选的模块、进度、会话状态和可编辑的「开场说」。点击「回到这次会话」或「开始学习」时，应用 SHALL 打开已有会话或新建学习会话，并以学习者身份发送开场内容。用户点击按钮前，交接卡 MUST NOT 触发任何跳转或学习数据变更。

#### Scenario: Starting a new session from chat
- **WHEN** 学习者点交接卡上的「开始学习」，「开场说」为「我们从比例的化简开始」
- **THEN** 应用新建该路径的学习模式会话，并以学习者身份发送这句话

#### Scenario: Handoff survives restart
- **WHEN** 含交接卡的回复保存后应用被强杀并重新打开该问答会话
- **THEN** 交接卡仍显示并可点击

#### Scenario: Target no longer exists
- **WHEN** 交接卡指向的路径已被删除，用户点击按钮
- **THEN** 应用提示该精通之路不存在并留在问答
