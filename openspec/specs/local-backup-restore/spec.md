# local-backup-restore Specification

## Purpose

定义 Learn Pace 的本地数据备份导出与恢复能力：一致性快照导出、覆盖 `manifest` 与 `payload` 的 SHA-256 完整性校验、显式凭据隔离、恢复前预览、全局写互斥以及含对账在内的原子无损回滚（对应 PRD 08 §9.3、NFR-07、AC-07）。

## Requirements

### Requirement: Consistent local snapshot export with manifest and checksum
应用 SHALL 导出一份自包含的本地备份，包含所有持久化学习表的一致性快照。备份中的模型配置须显式标记为未绑定凭据。备份须包含清单 `manifest`（`format_version`、`app_version`、`schema_version`、`exported_at`、各类实体计数和 `includes_credentials: false`）及覆盖清单字段与数据载荷 `payload` 的 SHA-256 摘要。

#### Scenario: Exporting a complete learning backup
- **WHEN** 用户在「我的」点击「导出本地备份」
- **THEN** 系统生成包含全部学习数据、实体计数摘要与覆盖 `manifest` 及 `payload` 的 SHA-256 校验值的一致性备份文件，并通过系统分享或文件保存交付给用户

### Requirement: Credential exclusion and explicit unbound state
导出的备份 MUST 排除 `SecureStore` 中的所有密钥，并通过 `credentialRef: null` 将模型配置显式标记为未绑定。若备份中的网关来源与本机不同，或备份与本机任一方没有模型配置，恢复后 MUST 保持未绑定，禁止回退到旧版密钥槽位。恢复期间 MUST 保留设备上的密钥。应用 SHALL 将不再引用的槽位标记为退役，并在新密钥保存成功后删除这些槽位。

#### Scenario: Inspecting an exported backup for secret leakage
- **WHEN** 用户已配置 DeepSeek Flash API Key 并导出本地备份
- **THEN** 导出的备份文件任意字段中均不包含 API Key 原文或有效 `credentialRef`，模型配置显式标注为未绑定凭据

#### Scenario: Restoring a cross-origin backup onto a device with a legacy key slot
- **WHEN** 目标设备 `SecureStore` 中残留旧版 `deepseek-api-key` 槽位，且用户恢复一份不同网关 origin 的备份
- **THEN** 应用保留本机旧凭据不删不发往新网关，配置读取器识别显式未绑定状态并返回「未配置」，提示用户为目标网关填写 API Key，且全部历史数据可离线浏览

#### Scenario: Retired device key is removed after a new key is saved
- **WHEN** 设备已为网关 A 配置 API Key，用户恢复一份网关 B 的备份，随后在「我的」为网关 B 填写并成功保存新 API Key
- **THEN** 恢复时网关 A 的 Key 未被删除，但被记为退役；保存新 Key 成功后，网关 A 的 Key 从 `SecureStore` 中删除，配置只引用新 Key

### Requirement: Restore preview and integrity validation
覆盖任何本地数据前，应用 SHALL 校验文件大小（至多 20 MiB）、JSON 语法、`format_version`、`schema_version` 兼容性，以及按规范化格式计算的、覆盖清单字段与数据载荷的 SHA-256 摘要，并 SHALL 预览导出时间及实体计数。文件超限、清单字段或数据记录被篡改、JSON 损坏或数据库版本超出当前支持范围时，应用 MUST 拒绝恢复并保持本地数据不变。

#### Scenario: Previewing a valid backup before confirmation
- **WHEN** 用户在「我的」选择一个有效的本地备份文件
- **THEN** 应用弹出恢复预览，展示导出时间、路径/会话/消息/证据数量以及将覆盖当前本地数据的提示，等待用户二次确认

#### Scenario: Rejecting a tampered manifest or payload
- **WHEN** 用户选择的备份文件超过 20 MiB，或 `manifest`（如计数或导出时间）或 `payload` 任一语义字段被篡改、JSON 损坏、`schema_version` 高于当前支持版本
- **THEN** 系统拒绝恢复并展示明确失败原因，当前本地学习数据保持完全不变

### Requirement: Atomic restore with reconciliation and write exclusion
恢复期间 MUST 独占全局写入权限以阻止并发写入。校验、数据表替换与对账 MUST 在同一原子事务内完成，任一步骤失败时整体回滚并保留原有数据。恢复成功后，应用 SHALL 重建内存中的服务实例并丢弃恢复前的内存状态，例如尚未提交的大纲预览。

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
