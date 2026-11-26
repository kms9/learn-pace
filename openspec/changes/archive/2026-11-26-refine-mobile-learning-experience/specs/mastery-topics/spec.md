## ADDED Requirements

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
