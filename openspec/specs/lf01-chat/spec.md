# lf01-chat Specification

## Purpose

定义 Learn Pace 的问答能力（P02，对应 DeepTutor 聊天）：多轮会话的创建与恢复、流式输出、停止与中断、重试、重新生成、删除整轮、「添加到对话框」引用、工具隔离，以及「转为学习目标」的跳转。

## Requirements

### Requirement: Multi-turn chat session lifecycle and history recovery
The system SHALL allow learners to create, list, reopen, and continue chat sessions locally, persisting user messages, assistant replies, the model used for each reply, and timestamps, and the session list MUST exclude Little Tutor side chats and mastery sessions.

#### Scenario: Creating and continuing a multi-turn session across restart
- **WHEN** 用户在「问答」点「新对话」并完成至少两轮提问与追问，随后强杀应用并重新打开
- **THEN** 会话列表中有该会话，打开后按时间顺序恢复全部消息与模型记录
- **AND** 用户可在原会话继续追问，回答结合此前对话

#### Scenario: Bounded context preserves local history and model attribution
- **WHEN** 会话历史超出上下文预算，或用户修改模型配置后继续提问
- **THEN** 模型请求按原角色和顺序携带已完成的历史，最多最近 12 条且合计不超过 12,000 个 Unicode 码点，当前提问只提交一次
- **AND** 本地仍可查看完整历史，并保留各轮实际使用的模型 ID

#### Scenario: Session list excludes side chats
- **WHEN** 用户在会话中创建小老师侧聊后打开会话列表
- **THEN** 列表只显示问答会话，不显示侧聊或精通会话

### Requirement: Streaming, stop, retry, regenerate, and delete turn
The system SHALL stream assistant output, allow the learner to stop an in-flight reply, mark interrupted or failed replies without fabricating completion, allow retrying interrupted or failed replies and regenerating the latest completed reply in place, and allow deleting a whole turn after confirmation.

#### Scenario: Stopping a streaming reply preserves partial output
- **WHEN** 助手正在流式回复时用户点「停止生成」
- **THEN** 系统中止请求，保留已收到的内容并标记为 `interrupted`，提供重试

#### Scenario: Model error shows a recoverable failure
- **WHEN** 网络异常或网关返回错误导致回复失败
- **THEN** 用户消息仍保存在会话中，回复显示为 `failed`，展示脱敏原因与重试入口

#### Scenario: Force-stop during streaming restores an interrupted reply
- **WHEN** 应用在已保存提问、回复尚未完成时被强杀
- **THEN** 重启后原会话显示 `interrupted` 与重试入口，恢复已保存的部分内容，不自动重发请求

#### Scenario: Regenerating the latest reply keeps message order
- **WHEN** 用户对最后一条已完成回复点「重新生成」，或对中断/失败回复点重试
- **THEN** 系统用原提问与其之前的有界历史发起新请求，在原位置更新该回复，会话中仍只有一条原提问

#### Scenario: Deleting a turn detaches its side chats
- **WHEN** 用户确认删除某一轮问答，且该轮回复下有小老师侧聊
- **THEN** 该轮提问与回复被删除，侧聊保留但解除与该消息的关联

### Requirement: Add selection to the composer as a quote
The system SHALL let the learner add a selected passage from a message to the current composer as a quote chip (at most three), send quotes together with the next message as labeled references, and MUST NOT send anything automatically.

#### Scenario: Quoting a passage into the next message
- **WHEN** 用户长按一条消息，确认一段选文后点「添加到对话框」，再输入问题发送
- **THEN** 输入框上方出现该引用条；发送后用户消息显示引用条，请求中引用以带编号的形式放在问题之前

### Requirement: Chat tool isolation and mastery boundary
问答回合 SHALL 仅使用只读的精通之路导航工具（`mastery_topics`、`mastery_sessions`、`mastery_open_session`、`mastery_new_session`）。小老师回合的工具白名单 SHALL 为空。两类回合均 MUST NOT 写入任何学习证据或掌握状态。

#### Scenario: Ordinary chat does not change mastery
- **WHEN** 用户在问答中提问或表示「我懂了」
- **THEN** 只保存会话记录，不写入任何精通之路的证据或掌握状态

#### Scenario: Side chat has no tools
- **WHEN** 用户在小老师侧聊中追问
- **THEN** 请求不携带任何工具

### Requirement: Turning a message into a learning goal
The system SHALL let the learner start goal creation from a message, navigating to `mastery/new` with `sourceSessionId`, `sourceMessageId`, and `sourceExcerpt` (confirmed selection or the whole message, at most 600 Unicode code points), without marking anything as mastered.

#### Scenario: Starting goal creation from a chat reply
- **WHEN** 用户在选文确认层点「转为学习目标」
- **THEN** 应用跳转到 `mastery/new` 并携带三个参数，原会话内容与状态不变

### Requirement: Selection actions on rendered replies
已完成的助手正文 SHALL 支持通过原生选区直接引用、问 Dito 或转为学习目标。Android SHALL 在选中正文时显示应用操作，兼容只提供标准动作的系统菜单。系统 MUST 核对选文与原始消息的区间。有多处匹配或无法确定原文区间时，系统 SHALL 提示用户在原文中确认选区。

#### Scenario: Selecting a distinct passage
- **WHEN** 用户在已渲染的回复里选择一段可唯一定位的文字，并点击「添加到对话框」
- **THEN** 该段原文以引用出现，未发送任何消息

#### Scenario: Confirming an ambiguous selection
- **WHEN** 同一选文在原文中重复出现，或渲染后的字符无法可靠定位到原文
- **THEN** 应用打开原文选区供用户确认，直接操作前不会采用任一候选区间

### Requirement: Find and start a chat
问答 SHALL 支持按标题搜索本地历史会话，搜索结果在键盘展开时仍须可点击，并在打开会话后显示其标题。新对话的空态 SHALL 提供可填入草稿的示例，点击示例 MUST NOT 发送消息或覆盖非空草稿。

#### Scenario: Finding a prior chat
- **WHEN** 用户按标题中的词搜索并打开结果
- **THEN** 历史只显示匹配记录，键盘展开时可以直接点选，打开后顶部显示该会话的标题

#### Scenario: Using a starter
- **WHEN** 用户在空白问答里点击一个起手示例
- **THEN** 示例进入草稿，可修改后手动发送

### Requirement: Low-emphasis reply actions, full-reply copy, and scroll-to-bottom
问答与小老师侧聊中，已完成的助手回复 SHALL 使用低权重的次要样式展示「选文」「复制」「重新生成」「删除整轮」等操作。学习者 SHALL 可一键将完整回复原文复制到系统剪贴板，应用短暂显示确认反馈。当学习者上翻长对话并离开最新消息时，应用 SHALL 显示悬浮的「回到底部」按钮。

#### Scenario: Copying an assistant reply
- **WHEN** 用户点击某条已完成助手回复下方的「复制」操作
- **THEN** 系统将该条回复原文写入剪贴板，并在该操作上短暂显示「已复制」反馈

#### Scenario: Scrolling up in a long conversation
- **WHEN** 用户在长对话中向上翻看历史消息，距底部超过阈值
- **THEN** 界面在输入框上方显示悬浮的「↓ 回到底部」按钮；点击后平滑滚回最新消息并恢复自动跟随
