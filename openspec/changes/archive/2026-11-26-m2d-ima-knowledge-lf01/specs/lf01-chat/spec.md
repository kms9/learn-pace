# Spec Delta

## MODIFIED Requirements

### Requirement: Chat tool isolation and mastery boundary
问答回合 SHALL 仅使用只读的精通之路导航工具（`mastery_topics`、`mastery_sessions`、`mastery_open_session`、`mastery_new_session`），并在当前 `lf01` 作用域启用适用 Skill 时按本轮快照与自动发现门禁追加注册只读 Skill 工具，以及在本轮显式绑定有效外部知识库时追加注册只读知识工具（`knowledge_list`、`knowledge_search`、`knowledge_read`）。小老师回合在无适用 Skill 与绑定库时工具白名单 SHALL 为空；有启用 Skill 或继承有效绑定库时 SHALL 仅注册对应的只读 Skill 与只读知识工具。两类回合均 MUST NOT 注册任何远端上传/写入工具，也 MUST NOT 写入任何学习证据或掌握状态。

#### Scenario: Ordinary chat does not change mastery
- **WHEN** 用户在问答中提问、使用已启用教学 Skill、结合外部知识库问答或表示「我懂了」
- **THEN** 只保存会话记录、轻量收据与离线引用快照，不写入任何精通之路的证据或掌握状态

#### Scenario: Side chat has no tools
- **WHEN** `little_tutor` 作用域未启用任何 Skill 且父会话回合未绑定外部知识库，用户在小老师侧聊中追问
- **THEN** 请求工具白名单为空，不携带任何工具

#### Scenario: Side chat with an enabled skill only receives read-only skill tools
- **WHEN** 用户将某教学 Skill 启用并绑定至 `little_tutor` 作用域（且无绑定知识库）后在小老师侧聊中追问
- **THEN** 该回合仅允许调用受本轮快照约束的只读 Skill 工具，不包含精通导航工具且不写回父会话或任何掌握状态

#### Scenario: Chat or side chat with a bound knowledge base only receives read-only knowledge tools
- **WHEN** 用户在问答选定已绑定知识库（或从该回合发起小老师追问）并发送消息
- **THEN** 该回合仅追加注册只读知识工具（`knowledge_list`、`knowledge_search`、`knowledge_read`），绝不注册文件上传或 URL 导入等写入工具，且不写入任何学习证据或掌握状态
