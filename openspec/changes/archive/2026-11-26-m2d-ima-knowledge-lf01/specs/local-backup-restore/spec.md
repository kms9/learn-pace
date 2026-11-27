# Spec Delta

## MODIFIED Requirements

### Requirement: Consistent local snapshot export with manifest and checksum
应用 SHALL 导出 `format_version: 2`、`schema_version: 8` 的自包含本地备份，包含全部 13 张持久化表（原 11 表加上 `provider_connections` 与 `source_bindings`）的一致性快照。备份中的模型配置与外部知识库连接 MUST 显式标记为未绑定凭据（`credential_ref: null`）且 MUST NOT 包含任何 `SecureStore` 凭据或签名下载 URL。清单 `manifest` 须包含实体计数（含 `provider_connections`、`source_bindings`）与 `includes_credentials: false` 及覆盖 `{ manifest, payload }` 的 SHA-256 摘要；超 20 MiB 拒绝导出。

#### Scenario: Exporting a complete learning backup
- **WHEN** 用户在「我的」点击「导出本地备份」
- **THEN** 系统生成 `format_version: 2`、`schema_version: 8`、包含全部 13 张表数据、实体计数摘要（含知识卡、技能与知识库连接/绑定计数）及覆盖 `manifest` 与 `payload` 的 SHA-256 校验值的一致性备份文件，所有外部连接均标记为未绑定凭据与断开态

### Requirement: Restore preview and integrity validation
覆盖任何本地数据前，应用 SHALL 校验文件大小（至多 20 MiB）、JSON 语法、`format_version` 与 `schema_version` 兼容性（支持 `format_version: 2` 下的 `schema_version: 8` 13 表与 `schema_version: 7` 11 表，以及历史 `format_version: 1` 下的 `schema_version: 5` 7 表与 `schema_version: 6` 8 表），按原始 `{ manifest, payload }` 校验 SHA-256 摘要并预览导出时间、实体计数与空库/停用/需重连提示。超限、被篡改、损坏或未来版本 MUST 被拒绝并保留原数据。

#### Scenario: Previewing a valid backup before confirmation
- **WHEN** 用户在「我的」选择一个有效的本地备份文件（`format_version: 2` 或兼容的旧版 `format_version: 1`）
- **THEN** 应用弹出恢复预览，展示导出时间、路径/会话/消息/证据/知识卡/技能/知识库绑定数量以及将覆盖当前本地数据的提示（明确技能恢复后默认停用、知识库需重新连接授权，旧版无对应表时提示将为空），等待用户二次确认

#### Scenario: Rejecting a tampered manifest or payload
- **WHEN** 用户选择的备份文件超过 20 MiB，或 `manifest`（如计数或导出时间）或 `payload` 任一语义字段被篡改、JSON 损坏、`format_version` 或 `schema_version` 高于当前支持版本
- **THEN** 系统拒绝恢复并展示明确失败原因，当前本地学习数据、技能、知识库连接与凭据保持完全不变

#### Scenario: Restoring a legacy v1 schema v5 backup
- **WHEN** 用户在当前 v8 应用中选择一份由 M2-B（`format_version: 1`、`schema_version: 5`、仅含 7 张表）导出的有效旧备份并确认恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的 `knowledge_cards`、技能表与 `provider_connections`/`source_bindings` 归一化为空列表并完成原子恢复，全部既有路径、会话与进度完整可用且不残留旧绑定

#### Scenario: Restoring a legacy v1 schema v6 backup
- **WHEN** 用户在当前 v8 应用中选择一份由 M2-C（`format_version: 1`、`schema_version: 6`、含 8 张表）导出的有效旧备份，在预览确认技能与外部知识库将为空后执行恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的技能表与 `provider_connections`/`source_bindings` 归一化为空列表并完成原子恢复，既有路径、会话、进度与知识卡完整可用

#### Scenario: Restoring a v2 schema v7 backup into a v8 database
- **WHEN** 用户在当前 v8 应用中选择一份由 Change 13（`format_version: 2`、`schema_version: 7`、含 11 张表）导出的有效备份并确认恢复
- **THEN** 应用先按原始 v2 schema v7 格式通过完整性与 Skill 包校验，再将缺失的 `provider_connections` 与 `source_bindings` 归一化为空列表并完成原子恢复，所有恢复的 Skill 默认停用

## ADDED Requirements

### Requirement: Portable external knowledge bindings without credentials
`format_version: 2`（`schema_version: 8`）备份导出与恢复前 MUST 校验 `provider_connections` 不含非空 `credential_ref` 且 `source_bindings` 仅引用存在的 `connection_id`。恢复成功后，全部外部知识库连接 MUST 保持未连接状态（`status = 'disconnected'`、`credential_ref = null`）待用户显式重新配置凭据与确认绑定，MUST NOT 按相同 origin 自动复用本机既有 `ima` 凭据；恢复期间保留本机旧凭据并记为退役待重配后清理，且恢复后不得对远端发起任何请求。

#### Scenario: Restoring a v2 schema v8 backup never auto-reuses local IMA credentials
- **WHEN** 本机已配置 `ima` 连接，用户恢复一份包含 `provider_connections` 与 `source_bindings` 的有效 v8 备份
- **THEN** 恢复后所有外部连接均处于未连接待重连态且 `credential_ref = null`，历史引用快照可离线浏览，原历史外部正文默认不自动外发，本机旧 `ima` 凭据在恢复期间不被删除且记为退役直到用户重新配置凭据
