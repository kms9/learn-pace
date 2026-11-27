# Design

## Context

当前仓库基线为 `docs/feasibility-plan @ 64d3034`：
- 数据库为 **SQLite v6**（8 张表：`settings`、`learning_progress`、`interactions`、`sessions`、`messages`、`session_threads`、`domain_events`、`knowledge_cards`），备份为 `format_version: 1`（支持 `schema_version: 5` 7 表与 `schema_version: 6` 8 表恢复）。
- `PiDurableRuntime`（`@earendil-works/pi-durable@1.6.0`）已支持 `registerTool(RuntimeTool)`、`RuntimeTurnRequest.instructions`、`allowedTools`、`AbortSignal`、`maxTurns`（默认 8）与 `tool_call`/`tool_result` 事件；`MemoryStorage` 仅用于单轮 Harness，本地 SQLite 才是业务权威存储。
- `Lf01ChatService` 已同时承载主问答（`lf01`）、小老师侧聊（`little_tutor`）与问答自测（`ChatQuickChecks`），其中 `publicChatMessage` 负责脱敏投影 `messages.metadata`，`ChatTurns.generate` 负责流式写入、中断、重试与重新生成。
- 固定子模块 `upstream/cherry-studio-mobile`（`14a0224fcdce482a36298a364799c52bb98a8ae8`）提供了纯 TS 的 Skill 包验证（`skillPackage.ts`）、有界流式 ZIP 读取（`zipReader.ts` / `skillArchive.ts`）、分片哈希（`sha256.ts`）、公开 GitHub 来源解析与 commit SHA 固定（`skillSources.ts`）、兼容性检查（`skillCompatibility.ts`）与只读工具（`skillTools.ts`）。Cherry 对本地导入不保存来源 locator（`installedSkillLocator` 返回 `null`），本地来源身份需由本 Change 自行定义（见决策 2）。

## Goals / Non-Goals

**Goals:**
- 建立移动端安全的 Skill 全生命周期（导入 → 校验预览 → 原子安装 → 查看/兼容性 → 启用/作用域绑定 → 显式/按需加载 → 更新/停用/卸载）。
- 严格区分 **Skill 包有效性**、**作用域启用状态** 与 **Host 能力就绪态**，保证包是不可信数据而非可执行插件。
- 完成 SQLite v6→v7 原子迁移与备份 `format_version: 2` 升级，同时无损兼容恢复历史 v1（schema v5 7 表 & v6 8 表）备份。
- 彻底修复 `ChatTurns` / `PiDurableRuntime` 的 3 个真实扩展边界：prepare 类型化错误、收据与回答成功解耦、无 terminator 场景下的并发回合共享预算与 checkpoint 收据合并。
- 无 Skill 启用时，LF01 问答、Dito 小老师、问答自测、知识卡、精通之路与备份恢复保持 100% 原有语义。

**Non-Goals:**
- 不实现 `ima` OpenAPI 网络传输、外部知识库连接/检索或 `KnowledgeProvider`（归属 Change 14）。
- 不接入 LF02 精通之路（归属 Change 15），不修改 `packages/domain`。
- 不实现任意脚本执行、动态工具注册、通用 HTTP、Skill 市场或 Agent CRUD。

## Decisions

### 1. 模块落点与纯 JS 依赖选型

- **依赖方向**：`apps/mobile -> packages/app-host -> packages/{runtime,infra,domain}`；`packages/domain` 不感知 Skill；`packages/runtime` 不依赖 Skill 业务模型，仅消费 `RuntimeTool` 与 `instructions`。
- **代码落点**：
  - `packages/infra/src/migrations.ts`、`packages/infra/src/{index,memory,expo,snapshot}.ts`：SQLite v7 迁移、`SkillStore` 仓储与 11 表快照。
  - `packages/app-host/src/extensions/`：
    - `skills/`：纯 TS 包校验器（`package-validator.ts`）、有界 ZIP 解析（`zip-reader.ts`）、GitHub 公开来源解析与 commit SHA 固定（`github-source.ts`，迁移自 Cherry `skillSources.ts`，仅保留 GitHub 来源）、兼容性与依赖解析（`compatibility.ts`）、包管理服务（`skill-service.ts`）。
    - `tool-catalog/`：最小可信工具目录（`ToolDescriptor` / `ToolRef`），Change 13 仅注册内置只读 Skill 工具与既有学习导航能力视图，不提供动态外部连接器注册。
    - `turn-scope/`：`TurnExtensionResolver`、回合共享原子预算（`TurnSkillBudget`）、4 个只读 Skill 工具工厂（`skill-tools.ts`）以及 `ExtensionPrepareError`。
  - `apps/mobile/app/settings/skills/`：`index.tsx`（列表 P07-S1）、`import.tsx`（导入与预览 P07-S3）、`[skillId].tsx`（详情/更新/作用域/卸载 P07-S2）；`apps/mobile/src/skill-io.ts` 封装 `expo-document-picker` 与 `expo-file-system` 二进制读取。
- **纯 JS 依赖（零原生 Android 模块）**：
  - `yaml`（参考 Cherry `2.9.0`）：严格 AST 解析 `SKILL.md` YAML Frontmatter，拒绝重复键、非法别名/锚点攻击与畸形结构。
  - `fflate`（参考 Cherry `0.8.3`）：结合 Cherry `zipReader.ts` 的中央目录预检 + 分片流式解压，拒绝 ZIP64、加密条目、symlink、CRC 错误与压缩炸弹，且在分片间让出 Hermes 主线程（`yieldToRuntime`）。
  - `@noble/hashes`（参考 Cherry `^1.8.0`）：实现跨 Node / Hermes 一致的分片流式 `directory-sha256`（与固定上游一致的 `directory-sha256:` 前缀和结构化目录摘要），避免原生桥接往返与全包拼接内存峰值。

### 2. SQLite v6 → v7 原子迁移与 `SkillStore`（`packages/infra`）

- `databaseSchemaVersion` 由 `6` 升至 `7`，`migrateV7(db)` 整体包裹在 `BEGIN IMMEDIATE … COMMIT`（失败 `ROLLBACK` 并重抛，沿用 `migration-sql.test.ts` 故障注入测试）：
  ```sql
  CREATE TABLE IF NOT EXISTS skills (
    skill_id TEXT PRIMARY KEY NOT NULL, -- 等于通过名称规则校验的 name
    -- origin_locator：GitHub 为 github:<owner>/<repo>/<directory>；本地来源为 local:<skill_id>
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('local_file', 'local_zip', 'github')),
    origin_locator TEXT NOT NULL,
    source_url TEXT,
    pinned_ref TEXT,
    active_revision TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    user_invocable INTEGER NOT NULL DEFAULT 1 CHECK (user_invocable IN (0, 1)),
    disable_model_invocation INTEGER NOT NULL DEFAULT 0 CHECK (disable_model_invocation IN (0, 1)),
    compatibility_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS skills_origin_unique
    ON skills (origin_kind, origin_locator);

  CREATE TABLE IF NOT EXISTS skill_revisions (
    skill_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    manifest_json TEXT NOT NULL,
    files_json_base64 TEXT NOT NULL,
    raw_bytes INTEGER NOT NULL,
    instructions_chars INTEGER NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (skill_id, revision)
  );
  CREATE INDEX IF NOT EXISTS skill_revisions_by_skill
    ON skill_revisions (skill_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS skill_bindings (
    skill_id TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('lf01', 'little_tutor')),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    updated_at REAL NOT NULL,
    PRIMARY KEY (skill_id, scope)
  );
  CREATE INDEX IF NOT EXISTS skill_bindings_by_scope
    ON skill_bindings (scope, enabled, skill_id);

  PRAGMA user_version = 7;
  ```
- **权威单一存储与 `SkillStorage` port**：有界包字节（`files_json_base64`）与 `manifest_json` 同存于 SQLite，配合 `RestoreGate` 与短事务原子发布，彻底规避文件系统与 SQLite 双写不一致。下载、ZIP 解压、YAML 解析与哈希计算均在事务外完成；发布、更新切换与卸载清理在短事务内执行。
- **Skill 身份与来源（决策 2）**：
  - `SKILL.md` 的 `name` 必须匹配 Cherry `SKILL_NAME_PATTERN`（`^[a-z0-9]+(?:-[a-z0-9]+)*$`，至多 64 字符），不符合即拒绝安装；`skill_id` 直接取 `name`，作为主键，同时承担「全库同名唯一」约束。
  - `origin_locator` 规则：GitHub 来源为 `github:<owner>/<repo>/<directory>`（沿用 Cherry `githubSkillLocator`，不含 ref，固定 SHA 存 `pinned_ref`）；本地来源（`local_file` / `local_zip`）统一为 `local:<skill_id>`，不保存不稳定的 `content://` URI。
  - 公开 GitHub URL 解析覆盖 3 种形态：仓库根（`https://github.com/{owner}/{repo}`）、目录（`.../tree/{ref}/{dir}`）与精确文件（`.../blob/{ref}/.../SKILL.md`，补充 Cherry `parseGithubSkillUrl` 仅认 `blob` 的缺口），统一解析到 commit SHA；无 token 匿名调用 GitHub API（60 次/小时）遇到 HTTP 403/429 时映射为明确限流提示，自动化测试一律注入 mock `fetch`。
  - 导入候选的 `skill_id` 已存在时：若已安装项与候选同属本地来源（`local_file` 与 `local_zip` 视为同一本地来源，可互相更新），或同为 GitHub 且 `origin_locator` 相同，则进入「更新」流程（差异预览后原子切换 `active_revision`，`origin_kind` 跟随新包）；否则视为同名异源并拒绝，提示用户先卸载已有 Skill。
  - 「检查更新」按已安装项的 `origin_locator` 拉取新版本；若新版本的 `name` 与已安装 `skill_id` 不同（上游改名），拒绝本次更新并提示「上游已改名，请卸载后重新安装」，不切换版本、不新建记录。
- **并发库变更（CAS）**：`RestoreGate.write` 只阻止恢复期间的写入，不串行化普通写操作，因此库变更不能依赖它防并发。
  - 预览结果携带其依据的 `expectedActiveRevision`（新安装为 `null`）。确认更新时，`SkillService` 在短事务内重新读取 `skills.active_revision`，与预期不一致则抛出 `SkillConflictError`，界面提示「技能已被更新，请重新预览」，不写入任何内容。
  - 确认安装时同样在事务内复查 `skill_id` 未被占用（或占用者满足同源更新条件并与预期版本一致），防止两次并行导入互相覆盖。
  - 启用开关与作用域绑定是幂等的单行写入，按最后一次写入生效。
- **旧版本回收（不引入内存 pin 计数）**：
  - 更新只切换 `skills.active_revision`，卸载只删除 `skills` 与 `skill_bindings` 行；运行中回合持有的是本轮快照中的固定 `(skillId, revision)`，按需从 `skill_revisions` 读取，因此旧行必须在回合期间保留。
  - 不变式：新回合只读取 `active_revision`（显式选择也只接受当前 `active_revision`，见第 4 节），回收只删除非 active 行；回合 MUST 先登记为活跃再取快照。满足这两点时，回收与取快照之间不需要额外加锁。
  - 回收时机：库变更事务提交后，若 `ChatTurns` 当前没有任何运行中的聊天回合（`SkillService` 通过注入的 `hasActiveTurns()` 判断，自测等其他回合也计入，只会让回收推迟），立即在短事务中删除「`skill_id` 已不存在或 `revision` 不等于 `active_revision`」的 `skill_revisions` 行；否则推迟到下一次库变更或冷启动。冷启动时 `RecoveryService` 无活跃回合，执行同一清理。
  - 回收只删除包字节，不改写历史消息中的 `skill_receipts`；保留中的旧版本计入 4 MiB 全库上限，超限时先尝试回收再判定。
- **容量与安全上限（按原始字节计，不信任声明压缩大小）**：
  - 单包原始字节 ≤ **2 MiB**，单文件 ≤ **512 KiB**，单包文件数 ≤ **100**，`SKILL.md` 正文 ≤ **24,000** 字符，全库活跃+保留版本原始文件字节总计 ≤ **4 MiB**；
  - 拒绝目录穿越（`..`、绝对路径、反斜杠、控制字符）、symlink/submodule、NFC 大小写路径碰撞、重复 YAML 键、Shell 插值（`` !`cmd` ``）与明显硬编码密钥模式（给出可操作提示）；
  - 同名异源（不同 `origin_kind`/`origin_locator` 但 `name` 相同）禁止静默覆盖；安装默认 `enabled = 0` 且不自动绑定任何 scope。

### 3. 三态分离与可信工具目录

- **状态正交建模**：
  1. `PackageState`：`valid` | `corrupted` | `missing` | `uninstalled`
  2. `ScopeState`：每个 `scope`（`lf01` | `little_tutor`）独立 `enabled` 开关（受包级 `enabled` 总闸门约束；Change 13 不开放 `mastery`）
  3. `CapabilityReadiness`：`ready` | `missing_tools` | `script_non_executable`（首期不做模型工具能力探测：`ModelConfig` 没有可判定工具调用能力的字段，P0 唯一模型 DeepSeek Flash 支持工具调用；不支持工具的端点在运行时按普通模型失败处理）
- **Host 权威授权**：`SKILL.md` 中的 `allowed-tools` 与 `compatibility` 仅作为声明解析；由 `ToolCatalog` 映射到 Host 已注册的稳定能力 ID 与可用性。任何未知工具均标为未满足，**绝不授予新工具权限或冒充内置连接器**；包内脚本/二进制仅作为不可执行资料保留，不允许模型通过 `read_skill_file` 读取非白名单文本或二进制文件。

### 4. 回合装配与 Runtime 契约加固（`chat-turns.ts`、`lf01-chat.ts`、`chat-quick-check.ts`）

- **写入前预解析（决策 1）**：
  - 现状：`ChatTurns.generate` 在调用 `prepare` 之前已把回复保存为 `generating` 并更新会话；`repeat` 复用原回复的 `message_id`。若在 `prepare` 内才发现旧 revision 缺失，`regenerate` 会把一条已 `committed` 的回答覆盖成失败。
  - 改为由 `Lf01ChatService` 在调用 `ChatTurns.send` / `ChatTurns.repeat` **之前**完成扩展解析：`send(sessionId, content, quotes, skillId?)` 直接解析入参；`retry` / `regenerate` 先读取消息并用 `turnFrom` 取得原用户消息，再解析其 `metadata.skill_selection`。解析根据 `scope = session.kind === "little_tutor" ? "little_tutor" : "lf01"` 调用 `TurnExtensionResolver.resolve(scope, selection)`，得到不可变的本轮快照（显式 Skill 的固定版本正文、允许自动发现的元数据索引、待注册工具）。
  - **登记与取快照顺序**：预解析在 `ChatTurns.exclusively` 的回调内执行，即回合已登记为活跃之后。`TurnExtensionResolver` 通过 `SkillStore.scopeSnapshot(scope)` 在同一个读事务内一次读出包级启用状态、该 scope 的绑定以及各 Skill 的 `active_revision` 与 manifest，不分多次查询，避免与并发更新交错读到混合状态。
  - **显式选择的提交与版本绑定**：
    - 新发送（`send` / `sendNew`）客户端只提交 `skillId`，每条消息至多 1 个；超过 1 个属于调用方错误，以 `Lf01ChatError` 拒绝（界面本身不允许选第二个）。
    - 预解析复查通过后，由 Host 用快照中该 Skill 的 `active_revision` 补全，并把 `skill_selection: [{ skillId, revision }]` 写入用户消息元数据。这样用户选好 chip 后 Skill 被更新，新发送自动使用确认过的新版本，不会报错。
    - `retry` / `regenerate` 读取历史记录中的 `revision`，必须等于快照里的 `active_revision`，否则抛出 `revision_missing`。即使旧 revision 行因回收推迟尚未删除也不接受，保证重试结果不取决于回收时机。
  - **新会话首发**：LF01 主问答在没有会话时，现有界面先调用 `startSession()` → `createSession()` 写入会话再发送，会绕过预解析。新增 `Lf01ChatService.sendNew(content, quotes, skillId?, { onSession, onMessage })`：先生成会话 ID 并以其登记活跃回合、完成预解析（只读），通过后再保存会话、立即调用 `onSession(session)`，然后进入 `ChatTurns.send`；预解析失败时不写入任何行。界面在 `onSession` 中设置会话状态（`chat.tsx` 需要完整会话对象），收到第一条用户消息后调用 `onFirstMessage`；`startSession` 只保留给「新对话」按钮。Dito 侧聊在用户点「问 Dito」时已由 `createThread` 创建，首发走普通 `send`。
  - 解析失败时直接向调用方抛出 `ExtensionPrepareError`，**不写入用户消息、不改动原回复、不更新会话、不发模型请求**；界面保留草稿与 chip 并展示原因。错误不持久化到消息。
  - 解析成功后，`Lf01ChatService` 以闭包把快照交给 `PrepareTurn`；`prepare` 只消费快照，不再二次解析，从而避免解析与运行之间的竞态。运行期间 Skill 被停用或更新不影响本轮快照。
  - 若当前 scope 既无显式选择、又无允许自动发现的已启用 Skill，则快照为空，**零改动透传原 `instructions` 与原 `allowedTools`**（LF01 仅导航工具、小老师为空白名单）。
- **重选恢复（决策 3）**：`retry` / `regenerate` 永不改写历史用户消息的 `skill_selection`。准备失败时界面提供「用当前版本重新发送」：把原用户消息正文、引用以及该 Skill 的 chip（只含 `skillId`，若在当前 scope 仍可显式调用）回填输入框，由用户确认后作为新一轮 `send` 发送，由 Host 绑定当时的 `active_revision`；Skill 已不可用时只回填正文与引用并说明原因。
- **显式调用与自动发现（双轨独立）**：
  - **显式调用（`user-invocable !== false`）**：composer 仅列出当前 scope 已启用且允许显式调用的 Skill，每条消息至多选 1 个，发送时只提交 `skillId`。预解析复查 scope、启用状态与必要依赖（重试时另查记录的 `revision` 是否等于当前 `active_revision`）后，将快照中该版本正文按受控边界标签预注入 `instructions`（计入本轮预算）并记录 `explicit_loaded` 收据。
  - **自动发现（`disable-model-invocation !== true`，DeepSeek Flash 实测门禁）**：仅向指令附加有限的可用 Skill 名称/描述索引。
  - **工具按用途分两组注册**：
    - 参考读取组（只要本轮有已加载的 Skill 就注册，含显式选中的 Skill，不受门禁影响）：
      - `list_skill_files`：列出**本轮已加载 Skill 固定版本**的 manifest 文件清单；
      - `read_skill_file`：仅读取本轮已加载 Skill 固定版本 manifest 内的受支持 UTF-8 文本文件（拒绝跨包、绝对路径、目录穿越、二进制与脚本执行），以数据标记返回。
    - 自动发现组（仅当门禁通过且当前 scope 存在允许自动发现的 Skill 时注册）：
      - `list_local_skills`：分页列出当前 scope 允许模型发现的 Skill 元数据；
      - `load_skill`：按 `skillId` 加载本轮快照中固定版本的 `SKILL.md` 正文（受预算约束）。
    - 门禁未通过时只注册参考读取组，界面只提供显式选择。
  - **门禁开关**：`TurnExtensionResolver` 读取一个代码内常量 `autoDiscoveryEnabled`（门禁结论写入后才设为 `true`），不做用户设置项。
  - **工具通道、结构化错误与收据隔离**：不同于 Cherry 的独立 system 通道，`PiDurableRuntime` 通过 tool result JSON 返回 `load_skill` 正文（带数据边界标记）；同时 `PiDurableRuntime` 在工具抛错时不会发出 `tool_result`，`toolSettled` 也不会触发。因此 4 个 Skill 工具对越权、越界、预算耗尽、版本缺失等可预期错误一律返回结构化结果（如 `{ ok: false, code }`），不抛异常（仅程序缺陷抛出）；轻量 `skill_receipts` 状态机由工具层内部直接维护并通过 `auditMetadata()` 暴露给 `ChatTurns`，严禁把 `PiDurableRuntime` `tool_result` 事件里的完整 24k/8k `output` 正文原样写入消息元数据或日志。
- **修复 3 个源码级 Runtime 边界**：
  1. **类型化准备错误（`ExtensionPrepareError`）**：错误码限定为 `revision_missing`、`scope_denied`、`skill_disabled`、`dependency_missing`，由写入前预解析抛出（见上文决策 1），携带脱敏原因与可操作提示，**绝不调用 `runtime.runTurn`、绝不静默换版或折叠为泛化「模型请求失败」**。`ChatTurns.generate` 中 `prepare` 的既有 catch 不再承担扩展错误；`retry` / `regenerate` 复查原 `user.metadata.skill_selection`，旧版已卸载或无权时同样在写入前失败，原回复保持不变。
  2. **业务可交付物与审计收据分离**：`PrepareTurn` 返回值区分 `businessMetadata?: () => Record<string, unknown> | undefined`（如 `handoffs`）与 `auditMetadata?: () => Record<string, unknown> | undefined`（如 `skill_receipts`）。`end_turn` 仅在 `content.trim()` 或 `businessMetadata?.()` 非空时判为 `committed`；仅含 `skill_receipts` 而无正文/交接卡的回合判为 `failed`（保留真实收据，不误报成功）。
  3. **回合共享原子预算与增量 checkpoint**：由于 `PiDurableRuntime` 在无 `termination` 工具（LF01/Dito 场景）时并发执行工具，`TurnSkillBudget` 采用同步原子预留（`reserve`）强制约束：
     - 单轮最多加载 **3 个 Skill**（显式选择至多 1 个，与 `load_skill` 合计）；
     - `SKILL.md` 正文与参考文件**共用**每轮 **24,000 字符**总预算（对应 PRD SKR-05「合计 24k」），显式预注入的正文同样计入；
     - 单次 `read_skill_file` 返回 ≤ **8,000 字符**，超出部分截断并标注 `truncated`；
     - 每轮 Skill 工具调用 ≤ **12 次**，另受 `maxTurns` 与模型上下文余量约束。
     超额调用立即返回有界结构化错误，不消耗或越界。单个正文接近 24,000 字符的 Skill 会耗尽本轮参考读取预算，详情页对此给出提示。工具 settle 与流式 checkpoint 均合并已落定的轻量 `skill_receipts`（仅存 `turnId`、`skillId`、`name`、`revision`、`mode`、`status`、`errorCode`，不复制包正文）。现有 checkpoint 只保存初始 `reply.metadata`，改为每次保存都合并当前 `auditMetadata()`；`tool_result` 后额外触发一次 checkpoint，不必等待下一个 `text_delta`。收据在 `tool_call` 时以 `started` 写入、在 `tool_result` 时落定，落定状态不会被后续 checkpoint 回退。
- **未确认收据的终态修复**：
  - 用户停止（`cancelled`）：`ChatTurns.generate` 写终态时把仍为 `started` 的收据改为 `interrupted`。
  - 进程强杀：冷启动时 `packages/app-host/src/recovery.ts` 在 `interruptedReplies` 把 `generating` 回复修复为 `interrupted` 的同一事务中，把其中仍为 `started` 的收据改为 `unknown`；已落定的收据保持原样，不伪造成功。
- **与 `ChatQuickChecks` / `publicChatMessage` 共存**：
  - `publicChatMessage`（[chat-quick-check.ts](file:///Users/logo/repo/learn-pace/packages/app-host/src/chat-quick-check.ts#L57-L60)）仅在消息含 `quick_check` 时走白名单裁剪；普通消息保留 `skill_selection` 与 `skill_receipts`；同时确保 `ChatTurns.repeat`、`boundedHistory` 与自测出题都不会把仅含 `skill_receipts` 的失败消息当作有效问答历史。

### 5. 备份格式 `format_version: 2` 与历史 v1（schema v5/v6）向后兼容

- **导出格式（`format_version: 2`, `schema_version: 7`）**：
  - `DatabaseSnapshot` 扩展至 **11 张表**（原 8 表 + `skills`、`skill_revisions`、`skill_bindings`）。
  - **只导出 active 版本**：`exportBackup` 在 `portableSettings` 同一处对快照做可移植过滤，`skill_revisions` 只保留 `(skill_id, active_revision)` 与 `skills` 一一对应的行，排除卸载后待回收的孤儿行与更新后保留的旧版本，确保「运行中卸载或更新后立即导出」的文件仍能通过 v2 引用校验。历史消息与其中的 `skill_receipts` 原样导出。`counts` 与 SHA-256 摘要按过滤后的实际载荷计算。
  - `BackupManifest` 升级为 `format_version: 2`，`counts` 在原 7 项基础上增加 `skills`、`skill_revisions`、`skill_bindings`；`includes_credentials: false` 不变，SHA-256 摘要继续覆盖规范化 `{ manifest, payload }`；总文件上限保持 **20 MiB**（超限明确拒绝，绝不悄悄裁剪 Skill 包）。
  - 严格沿用现有 `portableSettings` 凭据过滤机制，禁止任何 Skill 配置或凭据字段穿透导出。
- **导入与兼容恢复矩阵**：
  - 接受 **`format_version: 2`（`schema_version: 7`，11 表）**；
  - 接受历史 **`format_version: 1`（`schema_version: 5` 7 表 与 `schema_version: 6` 8 表）**：先按原始 `{ manifest, payload }` 校验 SHA-256 与旧版计数结构，校验通过后在内存中将缺失表归一化为空数组（`knowledge_cards: []`、`skills: []`、`skill_revisions: []`、`skill_bindings: []`）；恢复预览明确提示「此旧版备份不包含技能库，恢复后本地技能将为空」。
  - **v2 Skill 完整性强校验**：要求 `skill_revisions` 与 `skills` 按 `(skill_id, active_revision)` 一一对应（无孤儿、无多余版本），`skill_bindings` 只引用存在的 Skill；逐条校验每个 revision 解码后的路径安全性、manifest 一致性、重新计算的 `directory-sha256` 与 `revision` 一致性，以及单包/总库原始字节上限。任一校验失败则整体拒绝，不触发替换，原本地数据与凭据零变化。
  - **恢复安全默认态**：v2 恢复写入前将所有 `skills.enabled` 与 `skill_bindings.enabled` 强制置为 `0`（默认停用），历史消息中的 `skill_receipts` 完整保留只读展示，需用户按需重新启用，恢复后绝不自动联网或执行脚本。
  - **恢复后重建服务**：沿用 `AppContext` 的 `restart()` / 服务重建机制，丢弃恢复前内存中的 Skill 列表与解析缓存。恢复期间 `RestoreGate` 已排除运行中回合，恢复后可直接执行一次旧版本回收。

### 6. 移动端交互（`apps/mobile`）

- **不新增一级 Tab**：在 `apps/mobile/app/(tabs)/me.tsx` 新增「技能管理」入口卡片，路由至 `apps/mobile/app/settings/skills/*`（沉浸式子页面，返回保留「我的」Tab 上下文）。
- **页面映射**：
  - `P07-S1`（技能列表）：已安装列表、名称/描述/来源/状态徽章、搜索、添加入口与空态。
  - `P07-S2`（技能详情）：原始 `SKILL.md` Markdown 展示、版本短哈希/来源、资源文件清单、兼容性与依赖就绪态、总开关与 `LF01` / `Dito 小老师` 独立作用域开关、检查更新（GitHub/受控本地同源）与二次确认卸载。
  - `P07-S3`（添加/更新预览）：支持本地文件（`SKILL.md` / `.zip`）与公开 GitHub URL 输入、多候选选择、校验失败详情、包大小/文件/差异预览与用户确认按钮、取消支持。
  - `P02-S` / `P02-R`（问答与小老师 composer 及回复区）：`ChatConversation` 新增显式 `scope: "lf01" | "little_tutor"` prop（分别由 `chat.tsx` 与 `[threadId].tsx` 传入，确保无 `sessionId` 的空白新对话也能正确列出本作用域可用技能）；composer 增加「技能」按钮与至多 1 个可移除结构化 chip（chip 只保存 `skillId`；与既有 `draft`/`quotes` 共用组件 `useState` 生命周期，随 Tab 切换保留、不额外建 SQLite 草稿表，删除 chip 不删包，提交后才持久化至 `user.metadata.skill_selection`）；回复下方以低权重方式展示实际加载/失败收据芯片，点击可查看执行详情（版本、读取文件、状态）。无可用 Skill 时给出清晰说明而不阻塞普通聊天。
  - **首发入口**：`ChatConversation` 在没有 `sessionId` 时改调 `chat.sendNew(...)`，不再先调用 `startSession()`；`chat.tsx` 通过新增的 `onSessionStarted` prop 接收 `onSession` 回调中的会话对象并设置会话状态。
  - **更新冲突**：确认更新遇到 `SkillConflictError` 时，预览页提示「技能已被更新，请重新预览」并重新拉取当前版本差异。
  - **准备失败与重选**：发送或重试遇到 `ExtensionPrepareError` 时，输入框保留草稿与 chip，在其上方展示原因（如「该技能版本已不存在」）；重试/重新生成失败时提供「用当前版本重新发送」，按决策 3 回填输入框，不自动发送。

## Risks / Trade-offs

- **[Risk] DeepSeek Flash 在 8 轮 `maxTurns` 内通过 `list_local_skills` / `load_skill` 自动发现并遵循 Skill 指令的稳定性与 token 开销尚未真机量化**
  - *Mitigation*：将自动发现设为明确实测门禁，分两步：第 1 组用脚本内占位工具做快速探测，判断设计方向；第 4 组完成后用 Host 真实工具跑正式门禁。
  - **快速探测实测**：用 `packages/app-host/scripts/probe-skill-discovery.ts` 对 DeepSeek Flash 各运行一次。分数除法问题依次列出、加载、列文件并读取参考，共 5 轮、5,477 prompt tokens。无关问题未调用技能工具，共 1 轮、893 prompt tokens。精通导航在无技能基线与显式预注入时均给出继续会话的交接卡，分别为 4 轮 / 3,659 prompt tokens 和 7 轮 / 10,394 prompt tokens。显式预注入时另有 3 次参考工具调用。这组样本只验证调用路径，正式通过线见下。
  - **正式门禁样例**：2 个教学 Skill（其中 1 个带参考文件）加 1 个干扰 Skill；12 条提问（6 条应触发、6 条不应触发），每条运行 3 次，共 36 次。另加 2 条需要精通导航的提问（同时注册导航工具与 Skill 工具），各运行 3 次，作为导航回归；现有 `smoke-deepseek.ts` 不覆盖导航工具，不能替代这一项。
  - **通过线**（全部满足才通过）：
    - 应触发时加载正确 Skill ≥ 80%；
    - 需要参考文件时读取到正确文件 ≥ 80%；
    - 不应触发时误加载 ≤ 20%；
    - 模型轮次中位数 ≤ 4，且没有一次触达 `maxTurns = 8`；
    - 相对无 Skill 基线的额外 prompt token 中位数 ≤ 8k；
    - 取消后 2 秒内进入 `cancelled` 达到 100%；
    - 导航回归提问正确调用精通导航工具并给出交接卡 100%。
  - 不通过时保持 `autoDiscoveryEnabled = false`（只注册参考读取组，界面只提供显式选择），在 `apps/mobile/README.md` 记录实测结果，绝不把未通过门禁的自动能力标为已支持。
- **[Risk] SQLite 存储 Base64 编码包体在备份导出时会产生 ~33% 体积膨胀与 Hermes 序列化内存峰值**
  - *Mitigation*：首期严格限定单包原始字节 2 MiB、全库原始字节 4 MiB（Base64 后约 5.3 MiB，远低于 20 MiB 备份总上限），并保留 `SkillStorage` port，未来若确需大文件包可平滑替换为文件原子发布方案。
- **[Risk] 恶意第三方 Skill 包尝试提示注入、越权工具名冒充或通过压缩炸弹/畸形 YAML 致崩溃**
  - *Mitigation*：防线放在 Host 硬约束而非仅靠 Prompt——预检 ZIP 中央目录与实际解压字节、拒绝非法路径与碰撞、工具白名单与路径边界由 Host 强校验、不可信内容加数据边界标记且绝不执行包内脚本。
- **[Risk] `format_version: 2` 升级后可能误拒现有用户的 M2-B（v5）或 M2-C（v6）旧备份**
  - *Mitigation*：保持先按备份原始版本计算 SHA-256、再做内存归一化的严格流程，并在 `backup-restore.test.ts` 中覆盖 v1/schema-5、v1/schema-6、v2/schema-7 三种完整往返与篡改/超限/坏包用例。
