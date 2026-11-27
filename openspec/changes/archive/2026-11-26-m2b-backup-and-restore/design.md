# Design

## Context

参见 `proposal.md`、`docs/prd/08-local-persistence.md` §9.3、Change 7（`runInTransaction` / SQLite v5）与 Change 8（`RecoveryService.reconcileInTransaction`）。M2-A 与 `m2a-mobile-ux-polish` 已归档；本 Change 在 Change 7、8 验收归档后实施，补齐一致性快照导出、全字段防篡改预览、显式凭据解绑以及含对账在内的原子无损恢复。

## Goals / Non-Goals

**Goals:**
- 导出格式覆盖全部 `manifest` 预览字段与 `payload` 数据的 SHA-256 完整性保护，且绝不泄露 API Key 或设备 `credentialRef`。
- 恢复期间通过全局独占闸门阻止一切并发业务写入，并将快照校验、全表替换与 `RecoveryService.reconcileInTransaction` 收口在同一原子边界内，任一步失败原库分毫不失。
- 彻底堵住 `AppBootstrapService.readModelRecord()` 缺省 `credentialRef` 回退旧版 `deepseek-api-key` 槽位的安全隐患。

**Non-Goals:**
- 不做云同步、定时自动备份或加密口令管理。
- 不备份外部二进制附件（留待第二波多源导入扩展 `format_version`）。

## Decisions

### 1. 备份包格式与全量完整性校验（`.lpbackup.json`）
- 备份文件为单文件 UTF-8 JSON：
  ```ts
  export interface BackupManifest {
    format_version: 1;
    app_version: string;
    schema_version: number;
    exported_at: number; // Unix seconds
    counts: {
      paths: number;
      sessions: number;
      messages: number;
      threads: number;
      interactions: number;
      evidence: number;
    };
    includes_credentials: false;
  }

  export interface BackupEnvelope {
    manifest: BackupManifest;
    payload: DatabaseSnapshot;
    integrity: {
      algorithm: "sha256";
      digest: string; // hex SHA-256 of canonicalJson({ manifest, payload })
    };
  }
  ```
- **哈希口径（明确覆盖 `manifest` + `payload`）**：
  - `integrity.digest` 对确定性键排序的 `canonicalJson({ manifest, payload })` 计算 SHA-256，**同时覆盖所有 `manifest` 预览字段（导出时间、版本、实体计数、`includes_credentials`）和 `payload` 全部业务记录**；
  - 校验规则明确：任何 JSON 语法破坏、`manifest` 任意字段修改或 `payload` 任意语义值修改都会触发校验失败被拒绝；纯非语义的 JSON 外部空白重排不影响规范 JSON 值，但如改变任何键、值、计数或版本号一律拒收。预览前先通过完整哈希校验，杜绝「伪造 `manifest.counts` 欺骗预览」的风险。

### 2. 显式「未绑定凭据」语义与旧槽位防护（`packages/app-host/src/app-bootstrap.ts`）
- 现有 `app-bootstrap.ts` 第 91 行 `const credentialRef = input.credentialRef ?? legacyKey;` 在遇到省略 `credentialRef` 的配置时会静默回退到旧槽位 `"deepseek-api-key"`，若恢复异源备份将造成旧 Key 被发往异源网关的安全风险！
- **修复方案**：
  - 升级 `StoredModelSettings` 允许 `credentialRef: string | null`，并新增可选字段 `retiredCredentialRefs?: string[]`（每项须匹配 `^deepseek-api-key(?:\.[\w-]+)?$`）：
    - `credentialRef === null` 表示**显式未绑定凭据**，`readModelRecord()` / `modelSettings()` / `getModelConfig()` 绝不回退读取 `legacyKey`，直接返回 `{ settings, configured: false }` / `null`；
    - 仅当 JSON 中 `credentialRef === undefined`（历史上最早版本的未迁移记录）时才保留向后兼容读取 `legacyKey`。
  - **导出时**：对 `settings["deepseek-model-config"]` 显式改写为 `{ ...publicSettings, credentialRef: null }`（剔除原设备 `credentialRef` 与 `retiredCredentialRefs`，绝不读/写 `SecureStore`）。
  - **恢复时**：
    - 绝不删除或改写本机 `SecureStore` 中已有槽位；
    - 若恢复前本机已有配置且 `new URL(local.baseUrl).origin === new URL(restored.baseUrl).origin` 且本机 `SecureStore` 存在有效 Key，则恢复后的记录绑定回本机原 `credentialRef`；
    - 否则（本机未配置或网关 origin 不同）强制写入 `credentialRef: null`，明确要求用户为新网关填写 API Key；
    - 不再被引用的本机槽位（恢复前本机配置的 `credentialRef`，以及其已有的 `retiredCredentialRefs`）合并去重后写入恢复后记录的 `retiredCredentialRefs`。恢复期间保留这些 `SecureStore` 槽位。设备从网关 A 的配置恢复到 B，再恢复 A 的备份时，A 保持未绑定，学习者需重新填写 Key。
  - **退役槽位的清理（`saveModelSettings`）**：
    - 带新 Key 保存且配置写入成功后，删除 `current.credentialRef`（非 `null` 时）与全部 `retiredCredentialRefs`，新记录不再携带该字段；
    - 不带新 Key 保存时，`current.credentialRef === null` 一律按缺少凭据处理并抛「请输入目标网关的 API Key」；成功路径原样保留 `retiredCredentialRefs`；
    - 删除失败为尽力而为（`catch` 后忽略），不影响保存结果。

### 3. 原子恢复边界（含对账）与全局写互斥闸门（`packages/infra`、`packages/app-host`）
- **全局独占恢复闸门（消除 TOCTOU 竞态）**：
  - 在 `AppBootstrapService`（与 `ChatTurns` / `MasterySessionService` / `Lf01ChatService` 共享）维护独占闸门 `RestoreGate`：
    - 任意写入入口（问答发送/重试/删除、小老师创建/追问、精通会话发送/作答/切模式/改名/重置/删除、模型设置保存）在进入前检查 `restoreGate.assertWritable()`；
    - `BackupRestoreService.restore()` 先原子置位 `restoring = true`，再核对当前没有任何正在进行的对话或路径回合（若有则立即释放闸门并拒绝恢复），整个恢复期间阻断一切新业务写入，直至恢复完成或失败释放。
- **单事务原子替换 + 事务内对账**：
  - `AppStore` 新增 `exportSnapshot()`（单只读事务导出 7 张表：`settings`、`learning_progress`、`interactions`、`sessions`、`messages`、`session_threads`、`domain_events`；Change 7 采用轻量幂等方案，不存在 `submissions` 表）与 `replaceSnapshot(snapshot, afterReplace?: (tx: AppStore) => Promise<void>)`（在单个 `runInTransaction` 内清空并写入全表，再在同一 `tx` 上执行 `afterReplace`）；
  - 恢复流程全部包在**同一个 `store.runInTransaction`** 中执行：
    1. 校验快照完整性与版本兼容；
    2. 按外键/表顺序清空并写入全部 7 张表（含上述 `credentialRef` 合并结果）；
    3. 经 `afterReplace(tx)` 在同一事务句柄上调用 Change 8 的 **`RecoveryService.reconcileInTransaction(tx)`**（收口备份中可能遗留的 `generating` 或半一致题卡）；
    4. 仅当上述 1–3 全部成功才提交事务；**任一步骤（包括对账）抛错，SQLite 事务与 `MemoryAppStore` 快照整体回滚，原数据库 100% 保持恢复前原状**。
- **恢复成功后重建内存服务**：`MasterySessionService.previews`（大纲预览）、`ChatTurns` 的回合与观察者状态、各服务实例都只存在内存中，仅刷新 snapshot 会让它们继续指向恢复前的数据。恢复事务提交并释放闸门后，`AppContext` 通过新增的 `restart()`（递增 `attempt`，复用已打开的 `ExpoLearningStore`）重新实例化 `AppBootstrapService`、`Lf01ChatService`、`MasterySessionService` 与 `LearningHomeService`，并重新执行一次幂等的 `recoverOnStartup()`。

### 4. 移动端文件 I/O 与「我的」设置页 UI（基于已归档的 `m2a-mobile-ux-polish`）
- 复用已安装的 `expo-crypto` 计算 SHA-256；新增 Expo 58 官方匹配包 `expo-file-system`（`~58.0.13`）、`expo-document-picker`（`~58.0.4`）与 `expo-sharing`（`~58.0.21`），读取备份文件限制上限 20 MiB（读取前先检查文件大小，超限直接拒绝）。
- 在 `apps/mobile/app/(tabs)/me.tsx` 基于 `m2a-mobile-ux-polish` 后的 `theme.ts` 语义 Token、`Card` 与 `ChatSheet` 新增「数据备份与恢复」卡片：导出分享、选文件预览（展示导出时间、实体计数、不含 API Key 说明、覆盖警示与二次确认）、成功后调用 `restart()` 重建应用服务与全局投影，以及清晰失败提示。

## Risks / Trade-offs

- **[Risk] 恢复过程中若仅在事务外做单次活跃回合检查，并发写入可能穿插进来** → Mitigation：通过共享 `RestoreGate` 先占锁再验无活跃回合，恢复结束前拦截所有写入入口。
- **[Risk] 设备 `SecureStore` 留有旧版 `deepseek-api-key` 时恢复异源配置可能误用旧 Key** → Mitigation：导出显式写 `credentialRef: null`，`readModelRecord()` 对 `null` 永不回退 `legacyKey`，并由自动化单测锁定该场景。
- **[Risk] 异源恢复后本机原 Key 不再被任何配置引用，成为无法访问也无法清理的孤儿密钥** → Mitigation：恢复时将其记入 `retiredCredentialRefs`，学习者下次成功保存新 Key 时统一删除。
- **[Risk] Hermes 一次性读取并解析大 JSON 时，字符串、解析结果与规范化序列化会同时驻留内存，峰值约为文件体积的数倍** → Mitigation：上限设为 20 MiB；P0 纯文本数据通常为数百 KB 到数 MB，远低于上限；如未来加入媒体附件再升级 `format_version` 采用分块归档格式。
- **[Risk] 新增 3 个 Expo 文件/分享模块会增加 Release APK 体积** → Mitigation：任务 4.1 实测 Android ARM64 Release APK 体积增量与冷启动耗时并记录至 `apps/mobile/README.md`。
