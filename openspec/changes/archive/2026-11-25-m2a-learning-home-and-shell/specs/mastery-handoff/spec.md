# Spec Delta

## Purpose

定义问答中通往精通之路的只读导航工具与交接卡（对应 DeepTutor `mastery_nav.py` 与 `MasteryHandoffCard`）。

## ADDED Requirements

### Requirement: Read-only mastery navigation tools in chat
Chat sessions SHALL offer `mastery_topics`, `mastery_sessions`, `mastery_open_session`, and `mastery_new_session` to the tutor, and these tools MUST NOT change any learning data or navigate on their own.

#### Scenario: Listing topics from chat
- **WHEN** 学习者在问答中问「我之前学的比例那条路学到哪了」
- **THEN** 导师可调用 `mastery_topics` 读取路径与进度，回答中不改变任何学习数据

### Requirement: Handoff cards
When the tutor calls `mastery_open_session` or `mastery_new_session`, the reply SHALL show a handoff card with the path, optional module, progress, session status, and an editable 「开场说」; tapping 「回到这次会话」 or 「开始学习」 SHALL open the session (creating a study session for new) and send the opening text as the learner, and not tapping MUST change nothing.

#### Scenario: Starting a new session from chat
- **WHEN** 学习者点交接卡上的「开始学习」，「开场说」为「我们从比例的化简开始」
- **THEN** 应用新建该路径的学习模式会话，并以学习者身份发送这句话

#### Scenario: Handoff survives restart
- **WHEN** 含交接卡的回复保存后应用被强杀并重新打开该问答会话
- **THEN** 交接卡仍显示并可点击

#### Scenario: Target no longer exists
- **WHEN** 交接卡指向的路径已被删除，用户点击按钮
- **THEN** 应用提示该精通之路不存在并留在问答
