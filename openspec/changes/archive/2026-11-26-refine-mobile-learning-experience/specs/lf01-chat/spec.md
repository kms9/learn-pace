## ADDED Requirements

### Requirement: Selection actions on rendered replies
已完成的助手正文 SHALL 支持通过原生选区直接引用、问 Dito 或转为学习目标。Android SHALL 在选中正文时显示应用操作，兼容只提供标准动作的系统菜单。系统 MUST 核对选文与原始消息的区间。有多处匹配或无法确定原文区间时，系统 SHALL 提示用户在原文中确认选区。

#### Scenario: Selecting a distinct passage
- **WHEN** 用户在已渲染的回复里选择一段可唯一定位的文字，并点击「添加到对话框」
- **THEN** 该段原文以引用出现，未发送任何消息

#### Scenario: Confirming an ambiguous selection
- **WHEN** 同一选文在原文中重复出现，或渲染后的字符无法可靠定位到原文
- **THEN** 应用打开原文选区供用户确认，直接操作前不会采用任一候选区间

### Requirement: Find and start a chat
问答 SHALL 支持按标题搜索本地历史会话，搜索结果在键盘展开时仍须可点击，并在打开会话后显示其标题。新对话的空态 SHALL 提供可填入草稿的示例，点击示例 MUST NOT 发送消息或覆盖非空草稿。

#### Scenario: Finding a prior chat
- **WHEN** 用户按标题中的词搜索并打开结果
- **THEN** 历史只显示匹配记录，键盘展开时可以直接点选，打开后顶部显示该会话的标题

#### Scenario: Using a starter
- **WHEN** 用户在空白问答里点击一个起手示例
- **THEN** 示例进入草稿，可修改后手动发送
