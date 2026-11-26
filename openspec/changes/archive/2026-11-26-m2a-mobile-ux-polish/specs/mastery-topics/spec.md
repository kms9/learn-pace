# Spec Delta

## MODIFIED Requirements

### Requirement: Mastery Path tab lists topics
The 精通之路 tab SHALL list all local mastery topics as whole-tappable cards showing emoji, name, and mastered-over-total progress (or 「去定大纲」 when empty), suppressing zero-due text when `dueCount === 0`, ordered by most recent update, with a compact header 「新建精通目标」 action, a per-topic review action only when `dueCount > 0`, and an empty state when no topic exists.

#### Scenario: Viewing topics with and without outlines
- **WHEN** 本地有一条已有大纲且无到期复习的路径和一条刚创建、大纲为空的路径
- **THEN** 列表显示两张整卡可点的卡片，前者显示「已掌握 x / 共 y」且不显示「0 项复习已到期」，后者显示「去定大纲」，点击卡片进入路径页

#### Scenario: Topic with due reviews keeps a quick review entry
- **WHEN** 某条路径有 2 项到期复习
- **THEN** 该卡片展示独立的到期复习入口，点击直接开启该路径的复习会话，点击卡片其他区域仍进入路径详情页

### Requirement: Path page overview
The path page SHALL show emoji, title, progress, and the 「下一个」 primary action first, place management actions (「改名」「重置进度」「删除主题」) inside a header 「···」 menu, display collapsible outline modules (with the active module expanded by default), list mastery sessions as compact tappable rows with relative timestamps, and provide a 「＋ 新建学习会话」 action.

#### Scenario: Path without an outline
- **WHEN** 用户打开一条大纲为空的路径
- **THEN** 「下一个」区显示「和导师一起定大纲」，点击进入该路径的编辑大纲会话

#### Scenario: Resuming a session from the path page
- **WHEN** 路径有两个会话，用户查看并点击其中一行
- **THEN** 列表以模式标签、最近消息摘要与相对时间（如「12 分钟前」）展示会话，整行点击即可打开该会话并保留其当前模式与全部消息

#### Scenario: Managing a topic from the header menu
- **WHEN** 用户在路径详情页点击右上角「···」菜单
- **THEN** 弹出管理菜单，包含「改名」「重置进度」「删除主题」，不再在页面底部堆叠全宽管理按钮

#### Scenario: Collapsing outline modules
- **WHEN** 路径包含多个大纲模块，用户点击某个模块标题
- **THEN** 大纲默认展开包含当前目标的模块，点击可折叠或展开任意模块
