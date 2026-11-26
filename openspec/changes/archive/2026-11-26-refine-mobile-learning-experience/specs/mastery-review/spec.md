## ADDED Requirements

### Requirement: Due actions identify the path being reviewed
精通之路列表的到期复习入口 SHALL 显示对应路径与到期题数。点击时 MUST 进入该路径的复习会话，开始消息的题目范围 SHALL 与所选路径匹配。

#### Scenario: More than one path is due
- **WHEN** 两条路径分别有 1 项和 2 项复习到期
- **THEN** 用户可以分别选择每条路径的复习入口，选择第二条路径只会复习第二条路径的 2 项
