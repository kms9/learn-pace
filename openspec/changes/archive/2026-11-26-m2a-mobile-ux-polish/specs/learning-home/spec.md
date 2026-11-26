# Spec Delta

## MODIFIED Requirements

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
