## MODIFIED Requirements

### Requirement: Handoff cards
导师调用 `mastery_open_session` 或 `mastery_new_session` 时，回复 SHALL 显示交接卡，包含路径、可选的模块、进度、会话状态和可编辑的「开场说」。主按钮 SHALL 排在展开的开场编辑内容前，开场说默认以短预览呈现。问答的交接提示 SHALL 要求导师仅提供一句简短说明，避免复述卡片内容及输出内部标识。点击「回到这次会话」或「开始学习」时，应用 SHALL 打开已有会话或新建学习会话，并以学习者身份发送开场内容。用户点击按钮前，交接卡 MUST NOT 触发任何跳转或学习数据变更。

#### Scenario: Starting a new session from chat
- **WHEN** 学习者点交接卡上的「开始学习」，「开场说」为「我们从比例的化简开始」
- **THEN** 应用新建该路径的学习模式会话，并以学习者身份发送这句话

#### Scenario: Handoff survives restart
- **WHEN** 含交接卡的回复保存后应用被强杀并重新打开该问答会话
- **THEN** 交接卡仍显示并可点击

#### Scenario: Target no longer exists
- **WHEN** 交接卡指向的路径已被删除，用户点击按钮
- **THEN** 应用提示该精通之路不存在并留在问答

#### Scenario: Editing a long opening
- **WHEN** 一张交接卡带有较长的开场说
- **THEN** 主按钮在开场预览上方，用户可展开开场文字并编辑，编辑后发送新内容
