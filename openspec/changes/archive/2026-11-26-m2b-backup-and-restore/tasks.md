# Tasks

> 前置：Change 7（`m2b-transactions-and-idempotency`）与 Change 8（`m2b-crash-recovery-and-clock`）均已验收归档（M2-A 与 `m2a-mobile-ux-polish` 均已归档）。

## 1. Snapshot Export & Transactional Replace (`packages/infra`)

- [x] 1.1 在 `packages/infra/src/{index,memory,expo}.ts` 定义 `DatabaseSnapshot` 类型并为 `AppStore` 实现 `exportSnapshot()`（单只读一致快照读出 7 张表：`settings`、`learning_progress`、`interactions`、`sessions`、`messages`、`session_threads`、`domain_events`）与 `replaceSnapshot(snapshot, afterReplace?)`（在单个 `runInTransaction` 中清空并写入全表，并在同一事务句柄 `tx` 上执行可选回调 `afterReplace(tx)`，任一步骤抛错整事务自动回滚）。在 `packages/infra/src/__tests__/memory-store.test.ts` 与 `migration-sql.test.ts` 验证导出一致性、替换及 `afterReplace` 失败时的全量回滚。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。

## 2. Backup/Restore Service, Explicit Unbound Credentials & Write Gate (`packages/app-host`)

- [x] 2.1 更新 `packages/app-host/src/app-bootstrap.ts` 的 `readModelRecord()`：明确区分 `credentialRef: null`（显式未绑定凭据，绝不回退旧版 `deepseek-api-key` 槽位）与历史缺省字段；新增 `retiredCredentialRefs`，并更新 `saveModelSettings()`：带新 Key 保存成功后删除原 `credentialRef` 与全部退役槽位，不带新 Key 时 `credentialRef: null` 按缺少凭据处理；引入共享全局 `RestoreGate`，在问答（含 `createSession`）、小老师（含 `deleteThread` / `updateThread`）、精通会话与设置等全部写入入口接入并发拦截。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 2.2 新增 `packages/app-host/src/backup-restore.ts` 实现 `BackupRestoreService`：`exportBackup()`（导出 `manifest` + `payload` + `integrity.digest = sha256(canonicalJson({ manifest, payload }))`，模型配置显式写 `credentialRef: null` 剥离凭据）、`inspectBackup(raw)`（校验 JSON、`format_version`、`schema_version` 与覆盖 `manifest`+`payload` 的 SHA-256 摘要，返回预览摘要）、`restoreBackup(raw)`（先占 `RestoreGate` 并确认无活跃回合，在 `replaceSnapshot` 同事务内调用 Change 8 的 `RecoveryService.reconcileInTransaction(tx)`，同源保留本机 `credentialRef`，异源/未配置写 `credentialRef: null` 并把不再引用的本机槽位记入 `retiredCredentialRefs`；导出时同时剥离 `retiredCredentialRefs`）。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 2.3 新增 `packages/app-host/src/__tests__/backup-restore.test.ts`，覆盖：完整导出与跨空库恢复、导出零 API Key 与显式 `credentialRef: null`、设备残留旧版 `deepseek-api-key` 时恢复异源备份绝不回退误用旧 Key、同源恢复保留本机 Key、异源恢复不删除本机 Key 但将其记为退役且在下次成功保存新 Key 后被删除、篡改 `manifest`（如计数/时间戳）或 `payload` 任一字段或破坏 JSON 均触发校验失败且原数据不动、未来 `schema_version` 被拒、活跃回合或恢复进行中并发写入均被正确拦截、注入替换或事务内对账失败后原数据 100% 无损保留。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Settings Backup & Restore UI (`apps/mobile`)

- [x] 3.1 在 `apps/mobile/package.json` 安装 Expo 58 匹配的 `expo-file-system`（`~58.0.13`）、`expo-document-picker`（`~58.0.4`）与 `expo-sharing`（`~58.0.21`），新增 `apps/mobile/src/backup-io.ts` 封装临时文件写入、系统分享导出、文件选择与 20 MiB 上限读取（读取前检查文件大小，超限直接拒绝）（复用已安装的 `expo-crypto` 计算 SHA-256）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 3.2 基于已归档的 `m2a-mobile-ux-polish` `me.tsx`、`theme.ts` 语义 Token 与 `ChatSheet`，新增「数据备份与恢复」卡片：「导出本地备份」与「从备份恢复」按钮、恢复前预览弹层（导出时间、实体计数、不含 API Key 说明、覆盖警示与二次确认）、成功后经 `apps/mobile/src/context/AppContext.tsx` 新增的 `restart()` 重建应用服务与全局投影（递增 `attempt`、复用已打开的 store），以及清晰失败提示。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Android ARM64 Physical Device Verification (AC-07)

- [x] 4.1 重新构建 Android ARM64 Release APK 并安装至真机（`86ceabbf`），完成 **AC-07** 全量验收：① 在含问答、小老师、精通路径与已掌握知识点的设备上导出备份，确认文件不含 API Key 且模型配置为显式未绑定；② 清空或重置本地数据后从该备份恢复，确认预览计数准确，恢复后学习首页、问答、精通之路、路径页与会话数据及进度完全一致，强杀重启后数据完整保留；③ 分别尝试篡改备份中 `manifest` 计数、`payload` 字段以及破坏 JSON 结构各一次，确认均被拒绝且现有本地学习数据分毫不失；④ 记录最新 Release APK 体积与冷启动时间并追加至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `local-backup-restore` 同步为主规格，标志 **M2-B（Change 7–9）全量达成**，进入 M3 真机发布门禁（AC-08）与第二波能力规划。
