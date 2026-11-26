# mastery-topics Specification

## Purpose

定义精通之路的入口与路径管理（对应 DeepTutor `TopicAtlas`、`CreateTopicWizard` 与路径页）：路径列表、两步新建向导、路径页基础版、改名、重置进度与删除主题。

## Requirements

### Requirement: Mastery Path tab lists topics
「精通之路」Tab SHALL 按最近更新时间顺序列出全部本地路径。每张卡片 SHALL 整卡可点击，展示表情图标、名称与已掌握数占总数的进度，大纲为空时提示「去定大纲」。有到期项时 SHALL 为对应路径单独展示复习入口，到期数为零时 SHALL 隐藏到期文案。顶部 SHALL 提供紧凑的「＋ 新建」入口以创建精通目标，无路径时 SHALL 展示空态。

#### Scenario: Viewing topics with and without outlines
- **WHEN** 本地有一条已有大纲且无到期复习的路径和一条刚创建、大纲为空的路径
- **THEN** 列表显示两张整卡可点的卡片，前者显示「已掌握 x / 共 y」且不显示「0 项复习已到期」，后者显示「去定大纲」，点击卡片进入路径页

#### Scenario: Topic with due reviews keeps a quick review entry
- **WHEN** 某条路径有 2 项到期复习
- **THEN** 该卡片展示独立的到期复习入口，点击直接开启该路径的复习会话，点击卡片其他区域仍进入路径详情页

### Requirement: Two-step creation wizard opens an outline session
The system SHALL create a topic through two steps (goal up to 2,000 characters plus emoji; optional materials from chat sessions, selections, or text notes, plus a read-only model summary), MUST create an empty path with a stable `path_id`, and SHALL open a new outline-mode session that automatically sends the opening message.

#### Scenario: Creating a topic without materials
- **WHEN** 用户填写目标、跳过资料并点「和导师一起定大纲」
- **THEN** 系统创建大纲为空的路径与一个编辑大纲模式的会话，进入会话并以学习者身份发送「用我选的资料，和我一起制定这个精通目标的大纲。」

#### Scenario: Creating a topic from a chat reply
- **WHEN** 用户从问答「转为学习目标」进入向导
- **THEN** 第二步已预选来源会话与选文，用户补充目标后创建的路径保存这些资料及其来源会话与消息 ID

#### Scenario: Goal is required
- **WHEN** 用户未填写目标就尝试进入第二步
- **THEN** 向导停留在第一步并提示需要填写目标

### Requirement: Path page overview
路径详情 SHALL 优先展示表情图标、名称、已掌握数占总数的进度，以及沿用 DeepTutor 文案的「下一个」主操作。页面 SHALL 显示学习目标、最多五条资料标签和只读大纲，大纲模块可折叠并默认展开当前知识点所在模块。「改名」「重置进度」「删除主题」SHALL 收纳在顶栏「···」菜单中。历史会话 SHALL 以带相对时间的紧凑整行入口展示，页面 SHALL 提供「＋ 新建学习会话」操作。

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

### Requirement: Reset progress and delete topic
The system SHALL offer 「重置进度」 and 「删除主题」 with confirmation; resetting MUST clear attempts, evidence, mastery, overrides, deferrals, review state, teaching records, and errors and abandon open question cards while keeping the outline, materials, goal, and learner profile; deleting MUST remove the path, its mastery sessions, messages, and question cards.

#### Scenario: Resetting progress keeps the outline
- **WHEN** 用户确认「重置进度」
- **THEN** 路径的大纲、资料与学习档案保留，所有知识点回到未学状态，进度显示为 0

#### Scenario: Deleting a topic
- **WHEN** 用户确认「删除主题」
- **THEN** 该路径及其会话从列表与存储中消失，问答会话不受影响

### Requirement: Path overview emphasizes what to do next
路径详情 SHALL 在学习档案和管理操作前展示进度及下一步主操作。大纲和复习计划 SHALL 排在学习档案前，改名、重置和删除仍可从路径管理入口访问。

#### Scenario: Opening a path with a pending task
- **WHEN** 用户打开一条有待答题的路径
- **THEN** 标题下优先显示进度和回到原会话作答的入口

### Requirement: Find chat materials in the creation wizard
新建精通目标向导的资料步骤 SHALL 优先显示已选资料和最近的问答会话，并支持按会话标题搜索所有可用问答会话。

#### Scenario: Searching for a source
- **WHEN** 用户在资料步骤输入旧会话标题中的词
- **THEN** 用户能从匹配结果选择原会话或其中消息，原先已选资料仍显示
