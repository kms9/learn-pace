# Spec Delta

## Purpose

定义 Learn Pace 移动端应用的一级 4 Tab 导航结构、P00 学习场景偏好入口、非强制启动恢复以及沉浸式子页面路由行为，为 LF01 与 LF02 功能提供稳定一致的应用导航壳。

## ADDED Requirements

### Requirement: Four-tab primary navigation
The application SHALL provide exactly four primary bottom tabs in order: 首页 (Home), 问答 (Chat), 路径 (Paths), and 我的 (Me/Settings), and switching between primary tabs MUST NOT reset or discard active state inside another tab.

#### Scenario: User switches between primary tabs
- **WHEN** 用户在任意一级 Tab 之间切换（例如从「首页」切换到「问答」再切回「首页」）
- **THEN** 应用显示对应 Tab 页面，且原 Tab 内已加载的数据或输入状态不被重置

### Requirement: Optional learning scene selection on first launch (P00)
The application SHALL present the learning scene selection screen (P00) with five curriculum profiles (小学、初中、高中、考证/自学、自由) when no scene preference has been persisted yet, and MUST allow the user to either select a scene with one confirmation or enter 自由 mode directly without forcing an educational stage.

#### Scenario: First launch without saved scene
- **WHEN** 用户首次打开应用且本地存储中尚无已保存的学习场景偏好
- **THEN** 应用展示 P00 场景选择页，提供五种场景卡片且不展示无依据的「推荐」标记
- **AND** 用户选中任意场景并确认后，应用持久化该场景偏好并进入「首页」Tab

#### Scenario: Subsequent launch skips mandatory scene selection
- **WHEN** 本地存储已存在学习场景偏好且用户重新启动应用
- **THEN** 应用直接进入主导航（默认「首页」Tab），不再重复弹出 P00

#### Scenario: Switching scene from settings preserves all learning data
- **WHEN** 用户从 P07「我的 / 设置」进入 P00 并切换到新的学习场景
- **THEN** 应用更新当前场景偏好并返回主导航
- **AND** 既有会话、学习路径与进度记录全部保留、不被删除

### Requirement: Immersive route support and safe-area layout
The navigation structure SHALL reserve dedicated full-screen routes (hiding the bottom tab bar) for goal creation (P04) and mastery workbench (P06), and all screens MUST respect Android system status bar and bottom navigation safe areas.

#### Scenario: Returning from a secondary route restores tab context
- **WHEN** 用户从一级 Tab 进入子页面（例如从 P07 进入 P00 场景切换页或开发模式 M1 工作台）后按系统返回键或返回按钮
- **THEN** 应用准确返回来源 Tab，且底部 4 Tab 栏恢复可见
