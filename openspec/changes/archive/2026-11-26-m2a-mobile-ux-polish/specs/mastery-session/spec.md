# Spec Delta

## ADDED Requirements

### Requirement: Live tutor tool progress indicator
During a running mastery turn, the session SHALL surface real-time Chinese status indicators reflecting active tutor tools instead of a static generic placeholder.

#### Scenario: Viewing real-time tutor tool progress
- **WHEN** 导师在编辑大纲或学习回合中调用 `read_source` 或 `mastery_build` 等工具
- **THEN** 正在生成的回复区实时显示对应中文阶段提示（如「正在读取资料…」「正在整理大纲…」），工具完成进入正文输出后切换为流式内容

### Requirement: Compact mode note, interactive outline sheet, and scroll-to-bottom
Once a mastery session contains messages, the top mode description line SHALL auto-collapse to maximize viewport height; tapping any knowledge point inside the session outline sheet SHALL open its evidence drawer; and scrolling away from the latest message SHALL show a floating 「回到底部」 button.

#### Scenario: Mode description collapses after conversation begins
- **WHEN** 用户在编辑大纲或复习会话中发出首条消息
- **THEN** 顶部模式说明行自动收起，仅在空会话时展开显示，为对话和题卡留出更多可视空间

#### Scenario: Inspecting objective evidence from the session outline sheet
- **WHEN** 用户在精通会话顶部点「大纲」打开大纲弹层，并点击其中某个知识点
- **THEN** 应用直接展示该知识点的掌握证据抽屉（含自报掌握入口），关闭抽屉后返回当前精通会话

#### Scenario: Scrolling up in a long mastery session
- **WHEN** 用户在长精通会话中向上翻看历史消息或题卡，距底部超过阈值
- **THEN** 界面在输入框上方显示悬浮的「↓ 回到底部」按钮；点击后平滑滚回最新消息并恢复自动跟随
