# Spec Delta

## Purpose

定义 Learn Pace 的小老师侧聊能力（对应 DeepTutor Dito 侧聊）：从消息选文发起侧聊、带入父会话的有界记录、预填不自动发送、在锚点消息下重开、删除与解除关联，且不写回父会话。

## ADDED Requirements

### Requirement: Anchored side chat creation and persistence
The system SHALL create a Little Tutor side chat from a confirmed selection in a completed message, persist `thread_id`, `parent_session_id`, `source_message_id`, `selected_text`, and the selection range, prefill the selection in the side chat composer without sending it, and show a 「小老师 ×N」 marker under the anchor message.

#### Scenario: Asking Dito about a selection
- **WHEN** 用户长按一条消息，确认选文后点「问 Dito」
- **THEN** 系统创建并保存侧聊，打开侧聊页面，顶部显示选文，选文预填在输入框中且未发送

#### Scenario: Validating a selection against its source message
- **WHEN** 选文在原消息中重复出现，或提交的片段与指定选区不匹配
- **THEN** 有多处匹配时使用用户确认的那一处；不匹配时提示重新选择并保留确认层

#### Scenario: Reopening a side chat after restart
- **WHEN** 用户在侧聊完成至少一轮追问后强杀应用，再打开原会话
- **THEN** 锚点消息下显示「小老师 ×1」，点开可恢复侧聊的选文与全部消息

### Requirement: Bounded parent context without writing back
Each side chat turn SHALL include the parent session's completed messages up to its latest message, taken newest-first and capped at 6,000 Unicode code points per message and 24,000 in total, plus the side chat's own bounded history, and the side chat MUST NOT change the parent session.

#### Scenario: Side chat request includes bounded parent transcript
- **WHEN** 用户在侧聊中发送追问
- **THEN** 请求以数据形式带入父会话最新的已完成消息（单条不超过 6,000、合计不超过 24,000 码点，按原顺序），再加上侧聊自身有界历史与当前追问

#### Scenario: Returning leaves the parent unchanged
- **WHEN** 用户在侧聊多轮追问后返回原会话
- **THEN** 原会话的消息、输入草稿与滚动位置保持原样

### Requirement: Managing side chats from the anchor marker
The system SHALL let the learner open, delete (with confirmation), or detach any side chat listed under a message's 「小老师 ×N」 marker; detached side chats MUST remain available from the session menu.

#### Scenario: Detaching a side chat
- **WHEN** 用户在「小老师 ×N」列表中对某个侧聊点「解除关联」
- **THEN** 该侧聊不再计入锚点消息的数量，但仍可从会话菜单的「小老师记录」打开

#### Scenario: Deleting a side chat
- **WHEN** 用户确认删除某个侧聊
- **THEN** 该侧聊及其消息被删除，父会话内容不变
