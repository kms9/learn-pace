# Spec Delta

## MODIFIED Requirements

### Requirement: Consistent local snapshot export with manifest and checksum
应用 SHALL 导出 `format_version: 2` 的自包含本地备份，包含全部 11 张持久化表（原 8 张学习表含 `knowledge_cards`，加上 `skills`、`skill_revisions` 与 `skill_bindings`）的一致性快照。备份中的模型配置须显式标记为未绑定凭据，且 MUST NOT 包含任何 `SecureStore` 凭据。备份须包含清单 `manifest`（`format_version: 2`、`app_version`、`schema_version: 7`、`exported_at`、含 `knowledge_cards`、`skills`、`skill_revisions`、`skill_bindings` 的实体计数及 `includes_credentials: false`）及覆盖规范化 `{ manifest, payload }` 的 SHA-256 摘要；总大小超过 20 MiB 时 MUST 拒绝导出。

#### Scenario: Exporting a complete learning backup
- **WHEN** 用户在「我的」点击「导出本地备份」
- **THEN** 系统生成 `format_version: 2`、`schema_version: 7`、包含全部 11 张表数据、实体计数摘要（含知识卡与技能计数）及覆盖 `manifest` 与 `payload` 的 SHA-256 校验值的一致性备份文件，并通过系统分享或文件保存交付给用户

### Requirement: Restore preview and integrity validation
覆盖任何本地数据前，应用 SHALL 校验文件大小（至多 20 MiB）、JSON 语法、`format_version` 与 `schema_version` 兼容性（支持 `format_version: 2` + `schema_version: 7`，以及历史 `format_version: 1` 的 `schema_version: 5` 7 表与 `schema_version: 6` 8 表备份），并按原始 `{ manifest, payload }` 校验 SHA-256 摘要。应用 SHALL 预览导出时间与实体计数；恢复旧版 v1 备份时预览 MUST 明确提示扩展技能库将为空。超限、被篡改、损坏或未来版本 MUST 被拒绝并保留原数据。

#### Scenario: Previewing a valid backup before confirmation
- **WHEN** 用户在「我的」选择一个有效的本地备份文件（`format_version: 2` 或兼容的旧版 `format_version: 1`）
- **THEN** 应用弹出恢复预览，展示导出时间、路径/会话/消息/证据/知识卡/技能数量以及将覆盖当前本地数据的提示（v2 明确技能恢复后默认停用，旧版 v1 明确扩展技能库将为空），等待用户二次确认

#### Scenario: Rejecting a tampered manifest or payload
- **WHEN** 用户选择的备份文件超过 20 MiB，或 `manifest`（如计数或导出时间）或 `payload` 任一语义字段被篡改、JSON 损坏、`format_version` 或 `schema_version` 高于当前支持版本
- **THEN** 系统拒绝恢复并展示明确失败原因，当前本地学习数据、技能与凭据保持完全不变

#### Scenario: Restoring a legacy v5 backup into a v7 database
- **WHEN** 用户在当前 v7 应用中选择一份由 M2-B（`format_version: 1`、`schema_version: 5`、仅含 7 张表）导出的有效旧备份并确认恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的 `knowledge_cards` 与 `skills`/`skill_revisions`/`skill_bindings` 归一化为空列表并完成原子恢复，全部既有路径、会话与进度完整可用且不残留旧技能绑定

#### Scenario: Restoring a legacy v1 schema v6 backup into a v7 database
- **WHEN** 用户在当前 v7 应用中选择一份由 M2-C（`format_version: 1`、`schema_version: 6`、含 8 张表）导出的有效旧备份，在预览确认扩展技能库将为空后执行恢复
- **THEN** 应用先按原始 v1 格式通过完整性校验，再将缺失的 `skills`/`skill_revisions`/`skill_bindings` 归一化为空列表并完成原子恢复，既有路径、会话、进度与知识卡完整可用且不残留旧技能绑定

### Requirement: Atomic restore with reconciliation and write exclusion
恢复期间 MUST 独占全局写入权限以阻止并发写入。应用 MUST 在全局写入互斥期间先校验备份文件，校验失败时保留原有数据。数据表替换与对账 MUST 在同一原子事务内完成，任一步骤失败时整体回滚并保留原有数据。恢复成功后，应用 SHALL 重建内存中的服务实例并丢弃恢复前的内存状态，例如尚未提交的大纲预览。

#### Scenario: Successful restore updates all screens consistently
- **WHEN** 用户确认恢复备份并在恢复完成后依次查看学习首页、问答、精通之路与路径详情
- **THEN** 全部页面展示备份中的会话、路径、大纲、证据与复习计划，且冷启动强杀重启后数据完整保留

#### Scenario: In-memory state from before the restore is discarded
- **WHEN** 恢复前某精通会话中存在尚未提交的大纲修订预览，随后完成备份恢复
- **THEN** 应用重建服务后该预览不再可提交，导师需基于恢复后的大纲重新预览

#### Scenario: Failure during replace or reconciliation preserves original data
- **WHEN** 恢复替换表或恢复内对账步骤发生异常
- **THEN** 整个恢复事务回滚，原有本地路径、会话、题卡与设置 100% 保持原状，不出现空库或半恢复状态

#### Scenario: Concurrent write attempts are blocked during restore
- **WHEN** 恢复正在执行期间，其他页面或服务尝试发起问答发送、作答提交或主题修改
- **THEN** 系统拒绝并发写入并提示正在恢复备份，避免恢复竞态

## ADDED Requirements

### Requirement: Export only active skill revisions
导出 `format_version: 2` 备份时，`skill_revisions` MUST 只包含与 `skills` 按 `(skill_id, active_revision)` 一一对应的行，排除卸载后待回收的孤儿版本与更新后暂时保留的旧版本；历史消息及其中的 `skill_receipts` 照常导出。`manifest.counts` 与 SHA-256 摘要 MUST 按过滤后的实际载荷计算，导出的文件 MUST 能通过本机的 v2 恢复校验。

#### Scenario: Exporting after uninstalling a skill during an active turn
- **WHEN** 某回合正在使用 Skill A 的固定版本时用户卸载 A（或把 A 更新到新版本），随后在回收完成前导出本地备份，再在本机或另一设备恢复该备份
- **THEN** 导出的 `skill_revisions` 不包含 A 的待回收版本，计数与摘要与实际载荷一致，引用 A 的历史消息与收据照常导出
- **AND** 该备份能通过 v2 完整性校验并成功恢复

### Requirement: Portable bounded Skill library extension
`format_version: 2` 备份恢复前 MUST 校验 `skill_revisions` 与 `skills` 按 `(skill_id, active_revision)` 一一对应、`skill_bindings` 只引用已有 Skill，以及安全路径、manifest、重算 `directory-sha256` 与容量上限。恢复成功时，全部恢复的 Skill 与作用域绑定 MUST 强制停用（`enabled = 0`）待重新启用，保留历史收据只读展示，且 MUST NOT 自动联网或执行脚本。任一校验失败 MUST 整体拒绝并保留原数据与凭据。

#### Scenario: Restore v2 backup containing valid skills
- **WHEN** 用户确认恢复包含合法 Skill 包、绑定与历史收据的 `format_version: 2` 备份
- **THEN** 全部学习数据、Skill 包与历史收据原子恢复且一致，所有恢复后的 Skill 与绑定均处于停用状态，未发生任何网络请求或脚本执行

#### Scenario: Reject v2 backup with corrupted or unsafe skill revision
- **WHEN** `format_version: 2` 备份中的某 `skill_revision` 存在包内容与 `directory-sha256` 不匹配、不安全路径、缺失 `active_revision` 引用、没有对应 Skill 的孤儿版本或超出容量限制
- **THEN** 恢复整体拒绝并给出明确错误，原有本地 Skill、学习数据与 `SecureStore` 凭据保持完全不变
