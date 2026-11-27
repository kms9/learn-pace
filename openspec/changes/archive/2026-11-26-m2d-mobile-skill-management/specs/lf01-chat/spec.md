# Spec Delta

## MODIFIED Requirements

### Requirement: Chat tool isolation and mastery boundary
问答回合 SHALL 仅使用只读的精通之路导航工具（`mastery_topics`、`mastery_sessions`、`mastery_open_session`、`mastery_new_session`），并在当前 `lf01` 作用域启用适用 Skill 时按本轮快照与自动发现门禁追加注册只读 Skill 工具（本轮有已加载 Skill 时注册 `list_skill_files`、`read_skill_file`；门禁通过时另注册 `list_local_skills`、`load_skill`）。小老师回合在未启用 `little_tutor` 作用域 Skill 时工具白名单 SHALL 为空；启用适用 Skill 时 SHALL 仅按同一规则注册只读 Skill 工具。两类回合均 MUST NOT 写入任何学习证据或掌握状态，且 MUST NOT 注册任意写操作、脚本执行或未授权外部网络工具。

#### Scenario: Ordinary chat does not change mastery
- **WHEN** 用户在问答中提问、使用已启用教学 Skill 或表示「我懂了」
- **THEN** 只保存会话记录与轻量收据，不写入任何精通之路的证据或掌握状态

#### Scenario: Side chat has no tools
- **WHEN** `little_tutor` 作用域未启用任何 Skill，用户在小老师侧聊中追问
- **THEN** 请求工具白名单为空，不携带任何工具

#### Scenario: Side chat with an enabled skill only receives read-only skill tools
- **WHEN** 用户将某教学 Skill 启用并绑定至 `little_tutor` 作用域后在小老师侧聊中追问
- **THEN** 该回合仅允许调用受本轮快照约束的只读 Skill 工具，不包含精通导航工具且不写回父会话或任何掌握状态
