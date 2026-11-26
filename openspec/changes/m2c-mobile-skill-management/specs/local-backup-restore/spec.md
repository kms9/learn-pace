# local-backup-restore Specification

## ADDED Requirements

### Requirement: Portable bounded Skill library extension
备份 v2 SHALL 包含已安装 Skill 版本、包 manifest/有界字节、绑定与历史收据，并覆盖于现有完整性摘要；MUST 校验格式、哈希、路径、引用、大小。支持 v1 读取迁移，v1 缺少 Skill 数据时恢复预览明确扩展库将为空。新恢复 Skill 默认停用，需用户重新授权。仍满足既有20 MiB备份上限、无凭据、RestoreGate 与原子回滚契约。

#### Scenario: Restore legacy v1 backup
- **WHEN** 用户预览并确认有效 v1 备份
- **THEN** 按旧格式校验后原子恢复业务数据，明确扩展库为空，不残留或隐式启用旧绑定

#### Scenario: Restore v2 backup containing skills
- **WHEN** 用户恢复带合法包及引用的 v2 备份
- **THEN** Skill 包和历史收据一致，默认停用待授权，业务数据保持完整；不会自动联网或执行脚本

#### Scenario: Invalid skill revision in backup
- **WHEN** 包内容与 hash 不匹配、路径不安全、引用缺失或超出限制
- **THEN** 恢复整体拒绝，原有 Skill、业务数据及凭据不变
