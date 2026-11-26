# learning-home Specification

## Purpose

定义「学习」Tab 的学习首页（对应 DeepTutor `LearningDashboard`）与跨页面的进度一致性。

## Requirements

### Requirement: What needs your attention
「学习」Tab SHALL 在「该做的事」中最多展示五项，先列出有待作答或待评分题卡的精通会话，再列出有到期复习的精通之路。点击会话项 SHALL 打开对应会话。到期路径 SHALL 标注「N 项复习已到期」，点击后开启复习会话并发送列出到期项的开场消息。

#### Scenario: Due reviews on the learning home
- **WHEN** 一条精通之路有 2 项复习到期
- **THEN** 「该做的事」显示该路径与「2 项复习已到期」，点击后新建复习会话并发送列出这两项的开场消息

#### Scenario: Waiting question card
- **WHEN** 某个精通会话中有一张未作答的题卡
- **THEN** 「该做的事」列出该会话与题干摘要，点击回到该会话且题卡仍可作答

### Requirement: Learning records and empty state
学习首页 SHALL 在「学习记录」中列出所有精通目标，展示表情图标、名称、已掌握数与总数；仅当 `dueCount > 0` 时展示到期徽章，无到期项时 MUST NOT 显示「0 项复习已到期」。「该做的事」中的待答题卡与到期复习项 SHALL 以不同语义标签区分。默认展示六条，用户可点「展开显示」查看其余记录；无目标时显示「精通之路」入口卡片，点击打开新建向导。

#### Scenario: Path with zero due reviews hides due badge
- **WHEN** 一条精通之路共有 4 个知识点、已掌握 2 个且当前到期数为 0
- **THEN** 学习首页的「学习记录」卡片仅显示进度「已掌握 2 / 共 4（50%）」，不显示「0 项复习已到期」

#### Scenario: Distinguishing pending questions from due reviews
- **WHEN** 「该做的事」同时包含一张待作答题卡和一条到期复习路径
- **THEN** 两类卡片分别展示清晰的语义状态标签（如「待作答」与「N 项复习已到期」），点击各自直达对应会话

#### Scenario: First launch with no topics
- **WHEN** 用户没有任何精通之路时打开「学习」
- **THEN** 页面显示「精通之路」入口卡片，点击打开新建精通目标向导

### Requirement: Consistent progress across screens
学习首页、精通之路列表、路径页与会话进度环 SHALL 使用同一个摘要函数和时钟计算已掌握数（含自报掌握）、总数、百分比、到期数和下一步操作。页面获得焦点、应用回到前台或导师回合结束后，各处 SHALL 刷新这些数据。

#### Scenario: Same numbers everywhere
- **WHEN** 某路径共 4 个知识点、已掌握 2 个、1 项到期，用户依次查看学习首页、精通之路列表、路径页与会话
- **THEN** 四处都显示 2 / 4（50%）与 1 项到期

#### Scenario: Refresh after a review failure
- **WHEN** 学习者在复习中答错使一个知识点回落，然后回到学习首页
- **THEN** 已掌握数减 1，该路径不再显示为已完成
