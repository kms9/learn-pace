# Spec Delta

## MODIFIED Requirements

### Requirement: Four-tab primary navigation
The application SHALL provide exactly four primary bottom tabs in order: 学习 (Learning home), 问答 (Chat), 精通之路 (Mastery Path), and 我的 (Me/Settings), MUST open 问答 by default on launch, and switching between primary tabs MUST NOT reset or discard active state inside another tab.

#### Scenario: Launching the app opens chat
- **WHEN** 用户启动应用
- **THEN** 应用直接进入「问答」Tab，不弹出任何场景选择页

#### Scenario: User switches between primary tabs
- **WHEN** 用户在任意一级 Tab 之间切换（例如从「问答」切换到「精通之路」再切回「问答」）
- **THEN** 应用显示对应 Tab 页面，且原 Tab 内已加载的数据或输入状态不被重置

### Requirement: Immersive route support and safe-area layout
The navigation structure SHALL reserve dedicated full-screen routes (hiding the bottom tab bar) for new mastery goal creation (`mastery/new`), the mastery path page and its sessions (`mastery/[pathId]/...`), and Little Tutor side chats, and all screens MUST respect Android system status bar and bottom navigation safe areas.

#### Scenario: Returning from a secondary route restores tab context
- **WHEN** 用户从一级 Tab 进入子页面（例如从「问答」进入小老师侧聊或 `mastery/new`）后按系统返回键或返回按钮
- **THEN** 应用准确返回来源 Tab，且底部 4 Tab 栏恢复可见

## REMOVED Requirements

### Requirement: Optional learning scene selection on first launch (P00)
**Reason**: 2026-11-25 决定复刻 DeepTutor（D7 修订、D8），DeepTutor 没有学习场景选择；P0 只提供自定义精通目标。
**Migration**: 移除首次启动跳转与 P07 中的场景入口；已保存的 `settings.curriculum_profile` 保留在数据库中但不再读取，不删除任何会话、路径或进度。
