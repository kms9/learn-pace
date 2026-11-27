# little-tutor-threads Specification

## Purpose

定义 Learn Pace 的小老师侧聊能力（对应 DeepTutor Dito 侧聊）：从消息选文发起侧聊、带入父会话的有界记录、独立展示选文并留空首问输入框、在锚点消息下重开、删除与解除关联，且不写回父会话。

## Requirements

### Requirement: Anchored side chat creation and persistence
系统 SHALL 从已完成消息的确认选区创建小老师侧聊，并保存侧聊、父会话、锚点消息、原文及选区。侧聊记录 SHALL 包含 `thread_id`、`parent_session_id`、`source_message_id`、`selected_text` 及选区范围。侧聊 SHALL 将选文显示为独立引用，初始问题输入框留空，创建时 MUST NOT 自动发送。锚点消息下 SHALL 显示「小老师 ×N」。

#### Scenario: Asking Dito about a selection
- **WHEN** 用户长按一条消息，确认选文后点「问 Dito」
- **THEN** 系统创建并保存侧聊，打开侧聊页面，顶部显示选文引用，用户可直接输入自己的问题

#### Scenario: Validating a selection against its source message
- **WHEN** 选文在原消息中重复出现，或提交的片段与指定选区不匹配
- **THEN** 有多处匹配时使用用户确认的那一处；不匹配时提示重新选择并保留确认层

#### Scenario: Reopening a side chat after restart
- **WHEN** 用户在侧聊完成至少一轮追问后强杀应用，再打开原会话
- **THEN** 锚点消息下显示「小老师 ×1」，点击直接打开侧聊并恢复选文与全部消息

### Requirement: Bounded parent context without writing back
Each side chat turn SHALL include the parent session's completed messages up to its latest message, taken newest-first and capped at 6,000 Unicode code points per message and 24,000 in total, plus the side chat's own bounded history, and the side chat MUST NOT change the parent session.

#### Scenario: Side chat request includes bounded parent transcript
- **WHEN** 用户在侧聊中发送追问
- **THEN** 请求以数据形式带入父会话最新的已完成消息（单条不超过 6,000、合计不超过 24,000 码点，按原顺序），再加上侧聊自身有界历史与当前追问

#### Scenario: Returning leaves the parent unchanged
- **WHEN** 用户在侧聊多轮追问后返回原会话
- **THEN** 原会话的消息、输入草稿与滚动位置保持原样

### Requirement: Managing side chats from the anchor marker
系统 SHALL 允许用户从消息的「小老师 ×N」打开侧聊，单条直接打开，多条可选。会话菜单的「小老师记录」SHALL 提供打开、确认删除和解除关联；解除关联的侧聊 MUST 仍可在该菜单中打开。

#### Scenario: Detaching a side chat
- **WHEN** 用户在「小老师记录」中对某个侧聊点「解除关联」
- **THEN** 该侧聊不再计入锚点消息的数量，但仍可从会话菜单的「小老师记录」打开

#### Scenario: Deleting a side chat
- **WHEN** 用户确认删除某个侧聊
- **THEN** 该侧聊及其消息被删除，父会话内容不变
