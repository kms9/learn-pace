# Proposal

## Why

Learn Pace 是单设备本地优先应用，用户的问答记录、小老师侧聊、精通大纲、作答证据与遗忘曲线复习状态全部存放在 `learn-pace.db` 中。在换机、重装或清理设备前，学习者需要一种完全可控、可校验完整性的本地备份导出与恢复机制，并且必须严格满足隐私与安全约束：默认绝不导出 `SecureStore` 中的 API Key，恢复前提供清晰摘要预览，任何文件损坏、版本不兼容或写入失败都必须完整保留原有学习数据（NFR-07、AC-07）。

## What Changes

- **一致性数据库快照与 Manifest 契约（`packages/infra`、`packages/app-host`）**：
  - 定义单文件 UTF-8 JSON 备份包 `learn-pace-backup-<timestamp>.lpbackup.json`（`manifest` + `payload` + `integrity`）：在单个只读事务内读取全部 7 张业务表，天然不含 `-wal` / `-shm` 临时文件与任何 `SecureStore` 凭据；
  - 导出时将 `settings` 中的模型配置显式改写为 `credentialRef: null`（仅保留 `baseUrl` / `model` / `reasoning` 等非敏感元数据，绝不写入 API Key 或设备 `credentialRef`）；
  - 生成 `manifest`：包含 `format_version`、`app_version`、`schema_version`、`exported_at`、实体统计（路径数、会话数、消息数、侧聊数、题卡数、证据数）与 `includes_credentials: false`；`integrity.digest` 对 `canonicalJson({ manifest, payload })` 计算 SHA-256，同时保护预览字段与业务数据。
- **备份校验、恢复前预览与无损回滚（`packages/app-host`、`packages/infra`）**：
  - 新增 `BackupRestoreService`：
    1. `inspectBackup(file)`：校验文件大小（≤ 20 MiB）、JSON 结构、`format_version`、`schema_version <= 当前应用支持版本` 与覆盖 `manifest` + `payload` 的 SHA-256，返回恢复前预览摘要（导出时间、路径/会话/消息/证据数量、模型配置提示）；
    2. `restoreBackup(file)`：先占用全局 `RestoreGate` 并确认无活跃回合，再在**单个 `runInTransaction`** 内完成快照校验、全表替换与 Change 8 的 `RecoveryService.reconcileInTransaction(tx)`；任一步失败由 SQLite 事务整体回滚，原数据原样保留，不做数据库文件级复制或替换。恢复过程不删除本机 `SecureStore` 中的任何密钥；恢复后不再被引用的本机密钥记为退役（`retiredCredentialRefs`），在学习者下次成功保存新 API Key 时统一删除，避免留下孤儿密钥；恢复成功后重建应用内服务，清除旧的内存状态。
- **「我的」页面数据管理 UI（`apps/mobile`）**：
  - 遵循 `m2a-mobile-ux-polish` 完成后的 `theme.ts` 语义 Token、`Card` 与 `ChatSheet` 风格，在 `apps/mobile/app/(tabs)/me.tsx` 新增「数据备份与恢复」卡片：
    - 「导出本地备份」：生成备份包并调用系统分享/保存（明确提示「备份不包含 API Key」）；
    - 「从备份恢复」：通过系统文件选择器挑选备份文件 → 弹出恢复预览 `ChatSheet` 展示实体统计、导出时间与覆盖风险提示 → 二次确认后执行恢复，成功后重建应用服务并刷新全应用投影（`restart()`）；失败时展示脱敏错误原因且原数据分毫不失。

### Non-Goals / Out of Scope
- **不做云端同步或跨设备账号体系**（单设备本地优先，仅支持用户显式导出/导入本地文件）。
- **绝不导出或备份 API Key / `SecureStore` 凭据**（换机恢复后由用户在「我的」重新填写或通过开发工具导入 Key）。
- **不扩大至外部二进制大附件备份**（P0 资料均为文本与选文，已全部存在 SQLite 中；第二波拍照/PDF 附件归档留到对应 Change 扩展 `manifest`）。

## Capabilities

### New Capabilities
- `local-backup-restore`: 定义一致性本地快照导出、manifest 与 SHA-256 完整性校验、凭据默认隔离、恢复前摘要预览与失败无损保留原数据能力（对应 PRD 08 §9.3、NFR-07、AC-07）。

### Modified Capabilities
（无；作为独立持久化运维能力新增 `local-backup-restore`，不修改已有能力规格。）

## Impact

- **受影响包**：`packages/infra`（SQLite 一致性快照/恢复底层适配器与内存等价实现）、`packages/app-host`（`BackupRestoreService`、manifest 校验与恢复前预览）、`apps/mobile`（`me.tsx` 数据备份与恢复卡片、恢复预览弹层，UI 样式基于 `m2a-mobile-ux-polish` 完成后基线）。
- **依赖影响**：`apps/mobile` 引入 Expo 58 匹配的 `expo-file-system`（`~58.0.13`）、`expo-document-picker`（`~58.0.4`）与 `expo-sharing`（`~58.0.21`），需在 Android ARM64 Release 构建中验证权限、系统文件选择器与 APK 体积增量（参照 `upstream/cherry-studio-mobile` 已在同版本 Expo 58 验证过的版本号）。
- **前置依赖**：Change 7（事务与 SQLite v5）与 Change 8（启动对账 `RecoveryService`）验收归档后实施（M2-A 与 `m2a-mobile-ux-polish` 已归档）。
