## ADDED Requirements

### Requirement: Keyboard space for answering a question card
精通会话 SHALL 在题卡的文本答案输入框获得焦点时收起通用聊天输入栏，并提供到下一处可填写答案及提交当前题卡的操作。用户关闭键盘、结束编辑或题卡退出待答时 SHALL 恢复通用输入，保留尚未发送的聊天草稿。

#### Scenario: Answering a multi-part question
- **WHEN** 用户在待答题组中点第一题的输入框并打开键盘
- **THEN** 通用聊天栏让出空间，用户可用「下一题」聚焦下一输入框，题组完整后可直接提交

#### Scenario: Returning to tutor chat
- **WHEN** 用户收起作答键盘并回到通用输入栏
- **THEN** 聊天草稿仍可继续编辑，题卡已填写的答案仍在
