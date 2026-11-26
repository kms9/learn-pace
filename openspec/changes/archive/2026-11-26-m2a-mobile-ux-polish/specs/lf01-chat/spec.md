# Spec Delta

## ADDED Requirements

### Requirement: Low-emphasis reply actions, full-reply copy, and scroll-to-bottom
Completed assistant replies in chat and Little Tutor side chats SHALL present reply actions (such as 选文, 复制, 重新生成, 删除整轮) in low-emphasis secondary styling rather than primary accent fills, SHALL allow one-tap copying of the full reply text to the system clipboard with brief visual confirmation, and long conversations SHALL show a floating 「回到底部」 button when the user scrolls away from the latest message.

#### Scenario: Copying an assistant reply
- **WHEN** 用户点击某条已完成助手回复下方的「复制」操作
- **THEN** 系统将该条回复原文写入剪贴板，并在该操作上短暂显示「已复制」反馈

#### Scenario: Scrolling up in a long conversation
- **WHEN** 用户在长对话中向上翻看历史消息，距底部超过阈值
- **THEN** 界面在输入框上方显示悬浮的「↓ 回到底部」按钮；点击后平滑滚回最新消息并恢复自动跟随
