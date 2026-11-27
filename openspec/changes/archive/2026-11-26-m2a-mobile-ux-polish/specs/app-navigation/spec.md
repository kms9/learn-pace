# Spec Delta

## MODIFIED Requirements

### Requirement: Four-tab primary navigation
The application SHALL provide exactly four primary bottom tabs in order: 学习 (Learning home), 问答 (Chat), 精通之路 (Mastery Path), and 我的 (Me/Settings), each displaying a consistent outline icon with its label tinted by active/inactive state, MUST open 问答 by default on launch, and switching between primary tabs MUST NOT reset or discard active state inside another tab.

#### Scenario: Launching the app opens chat
- **WHEN** 用户启动应用
- **THEN** 应用直接进入「问答」Tab，不弹出任何场景选择页
- **AND** 底部四个一级 Tab 均展示统一风格的线性图标与中文标题，当前「问答」高亮为主色

#### Scenario: User switches between primary tabs
- **WHEN** 用户在任意一级 Tab 之间切换（例如从「问答」切换到「精通之路」再切回「问答」）
- **THEN** 应用显示对应 Tab 页面，且原 Tab 内已加载的数据或输入状态不被重置
