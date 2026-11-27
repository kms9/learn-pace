# Spec Delta

## MODIFIED Requirements

### Requirement: Chat tool isolation and mastery boundary
Chat turns SHALL run with only the read-only mastery navigation tools (`mastery_topics`, `mastery_sessions`, `mastery_open_session`, `mastery_new_session`), Little Tutor turns SHALL run with an empty tool allowlist, and neither MUST write any learning evidence or mastery state.

#### Scenario: Ordinary chat does not change mastery
- **WHEN** 用户在问答中提问或表示「我懂了」
- **THEN** 只保存会话记录，不写入任何精通之路的证据或掌握状态

#### Scenario: Side chat has no tools
- **WHEN** 用户在小老师侧聊中追问
- **THEN** 请求不携带任何工具
