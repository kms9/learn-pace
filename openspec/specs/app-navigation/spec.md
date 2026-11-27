# app-navigation Specification

## Purpose

定义 Learn Pace 移动端应用的一级 4 Tab 导航结构、默认问答页以及沉浸式子页面路由行为，为 LF01 与 LF02 功能提供稳定一致的应用导航壳。

## Requirements

### Requirement: Four-tab primary navigation
应用 SHALL 按「学习」「问答」「精通之路」「我的」顺序提供且仅提供四个底部一级 Tab。每个 Tab SHALL 显示统一风格的线性图标与文字标签，并随选中状态切换颜色。启动时 MUST 默认进入「问答」，切换一级 Tab 时 MUST 保留其他 Tab 的活动状态。

#### Scenario: Launching the app opens chat
- **WHEN** 用户启动应用
- **THEN** 应用直接进入「问答」Tab，不弹出任何场景选择页
- **AND** 底部四个一级 Tab 均展示统一风格的线性图标与中文标题，当前「问答」高亮为主色

#### Scenario: User switches between primary tabs
- **WHEN** 用户在任意一级 Tab 之间切换（例如从「问答」切换到「精通之路」再切回「问答」）
- **THEN** 应用显示对应 Tab 页面，且原 Tab 内已加载的数据或输入状态不被重置

### Requirement: Immersive route support and safe-area layout
The navigation structure SHALL reserve dedicated full-screen routes (hiding the bottom tab bar) for new mastery goal creation (`mastery/new`), the mastery path page and its sessions (`mastery/[pathId]/...`), and Little Tutor side chats, and all screens MUST respect Android system status bar and bottom navigation safe areas.

#### Scenario: Returning from a secondary route restores tab context
- **WHEN** 用户从一级 Tab 进入子页面（例如从「问答」进入小老师侧聊或 `mastery/new`）后按系统返回键或返回按钮
- **THEN** 应用准确返回来源 Tab，且底部 4 Tab 栏恢复可见
