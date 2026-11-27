# Spec Delta

## MODIFIED Requirements

### Requirement: Consistent local snapshot export with manifest and checksum
应用 SHALL 导出 `format_version: 2`、`schema_version: 9` 的自包含本地备份，包含全部 13 张持久化表（原 11 表加上 `provider_connections` 与 `source_bindings`）的一致性快照。模型配置（`credentialRef: null`）与外部知识库连接（`credential_ref: null`）MUST 显式标记为未绑定凭据，备份 MUST NOT 包含任何 `SecureStore` 凭据或签名下载 URL。清单 `manifest` SHALL 记录格式与 Schema 版本、`app_version`、`exported_at`、各表实体计数和 `includes_credentials: false`。备份 SHALL 包含覆盖规范化 `{ manifest, payload }` 的 SHA-256 摘要；超过 20 MiB 时 MUST 拒绝导出。

#### Scenario: Exporting a complete learning backup
- **WHEN** 用户在「我的」点击「导出本地备份」
- **THEN** 系统生成 `format_version: 2`、`schema_version: 9`、包含全部 13 张表数据、实体计数摘要（含知识卡、技能与知识库连接/绑定计数）及覆盖 `manifest` 与 `payload` 的 SHA-256 校验值的一致性备份文件，所有外部连接均标记为未绑定凭据与断开态
- **AND** 应用通过系统分享或文件保存将备份交付给用户

### Requirement: Restore preview and integrity validation
覆盖任何本地数据前，应用 SHALL 校验文件大小（至多 20 MiB）、JSON 语法、`format_version` 与 `schema_version` 兼容性（支持 `format_version: 2` 下的 `schema_version: 9` 和 `schema_version: 8` 13 表、`schema_version: 7` 11 表，以及历史 `format_version: 1` 下的 `schema_version: 5` 7 表与 `schema_version: 6` 8 表），按原始 `{ manifest, payload }` 校验 SHA-256 摘要并预览导出时间、实体计数与空库/停用/需重连提示。超限、被篡改、损坏或未来版本 MUST 被拒绝并保留原数据。

#### Scenario: Previewing a valid backup before confirmation
- **WHEN** 用户在「我的」选择一个有效的本地备份文件（`format_version: 2` 或兼容的旧版 `format_version: 1`）
- **THEN** 应用弹出恢复预览，展示导出时间、路径/会话/消息/证据/知识卡/技能/知识库绑定数量以及将覆盖当前本地数据的提示（明确技能恢复后默认停用、知识库需重新连接授权，旧版无对应表时提示将为空），等待用户二次确认

#### Scenario: Rejecting a tampered manifest or payload
- **WHEN** 用户选择的备份文件超过 20 MiB，或 `manifest`（如计数或导出时间）或 `payload` 任一语义字段被篡改、JSON 损坏、`format_version` 或 `schema_version` 高于当前支持版本
- **THEN** 系统拒绝恢复并展示明确失败原因，当前本地学习数据、技能、知识库连接与凭据保持完全不变

#### Scenario: Restoring a legacy v1 schema v5 backup
- **WHEN** 用户在当前 v9 应用中选择一份由 M2-B（`format_version: 1`、`schema_version: 5`、仅含 7 张表）导出的有效旧备份并确认恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的 `knowledge_cards`、技能表与 `provider_connections`/`source_bindings` 归一化为空列表并完成原子恢复，全部既有路径、会话与进度完整可用且不残留旧绑定

#### Scenario: Restoring a legacy v1 schema v6 backup
- **WHEN** 用户在当前 v9 应用中选择一份由 M2-C（`format_version: 1`、`schema_version: 6`、含 8 张表）导出的有效旧备份，在预览确认技能与外部知识库将为空后执行恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的技能表与 `provider_connections`/`source_bindings` 归一化为空列表并完成原子恢复，既有路径、会话、进度与知识卡完整可用

#### Scenario: Restoring a v2 schema v7 backup into a v8 database
- **WHEN** 用户在当前 v9 应用中选择一份由 Change 13（`format_version: 2`、`schema_version: 7`、含 11 张表）导出的有效备份并确认恢复
- **THEN** 应用先按原始 v2 schema v7 格式通过完整性与 Skill 包校验，再将缺失的 `provider_connections` 与 `source_bindings` 归一化为空列表并完成原子恢复，所有恢复的 Skill 默认停用

#### Scenario: Restoring marketplace and legacy skill sources
- **WHEN** 用户恢复一份含市场技能的 v9 备份，或恢复既有 v8 备份
- **THEN** 应用校验并保留技能来源与固定版本，恢复后的技能及绑定停用。v8 备份依然可以恢复。任何来源格式无效时拒绝整个备份
