# Spec Delta

## MODIFIED Requirements

### Requirement: Consistent local snapshot export with manifest and checksum
应用 SHALL 导出一份自包含的本地备份，包含全部 8 张持久化学习表（含 `knowledge_cards`）的一致性快照。备份中的模型配置须显式标记为未绑定凭据。备份须包含清单 `manifest`（`format_version`、`app_version`、`schema_version`、`exported_at`、含 `knowledge_cards` 的各类实体计数和 `includes_credentials: false`）及覆盖清单字段与数据载荷 `payload` 的 SHA-256 摘要。

#### Scenario: Exporting a complete learning backup
- **WHEN** 用户在「我的」点击「导出本地备份」
- **THEN** 系统生成包含全部 8 张表数据、实体计数摘要（含知识卡数量）与覆盖 `manifest` 及 `payload` 的 SHA-256 校验值的一致性备份文件，并通过系统分享或文件保存交付给用户

### Requirement: Restore preview and integrity validation
覆盖任何本地数据前，应用 SHALL 校验文件大小（至多 20 MiB）、JSON 语法、`format_version`、`schema_version` 兼容性（支持当前 v6 及历史 v5 备份），以及覆盖清单字段与数据载荷的 SHA-256 摘要，并 SHALL 预览导出时间及实体计数；超限、被篡改、JSON 损坏或未来版本 MUST 被拒绝且原数据不变。

#### Scenario: Previewing a valid backup before confirmation
- **WHEN** 用户在「我的」选择一个有效的本地备份文件
- **THEN** 应用弹出恢复预览，展示导出时间、路径/会话/消息/证据/知识卡数量以及将覆盖当前本地数据的提示，等待用户二次确认

#### Scenario: Rejecting a tampered manifest or payload
- **WHEN** 用户选择的备份文件超过 20 MiB，或 `manifest`（如计数或导出时间）或 `payload` 任一语义字段被篡改、JSON 损坏、`schema_version` 高于当前支持版本
- **THEN** 系统拒绝恢复并展示明确失败原因，当前本地学习数据保持完全不变

#### Scenario: Restoring a legacy v5 backup into a v6 database
- **WHEN** 用户在 v6 应用中选择一份由 M2-B（`schema_version: 5`、仅含 7 张表）导出的有效旧备份并确认恢复
- **THEN** 应用通过完整性校验、自动将缺失的 `knowledge_cards` 归一化为空列表并完成原子恢复，全部既有路径、会话与进度完整可用
