# Proposal

## Why

当前 Learn Pace 已完成 M2-A（LF01 问答/小老师、LF02 精通之路）、M2-B（事务/幂等/恢复/备份）、M3（Android ARM64 Release 基线）及 M2-C（本地复习提醒、问答自测、错题回看与轻量知识卡，SQLite v6 / 8 表备份）。但教学方法与辅导指令仍硬编码在客户端代码中，难以按学习场景复用和迭代；同时，后续接入 `ima` 等外部知识库（Change 14）前，也需要先建立统一的 Skill 生命周期、回合作用域装配与可信工具目录边界。

本 Change 作为 **V0.5 / M2-D（Change 13）** 的首个竖切，参考仓库固定子模块 `Cherry Studio Mobile`（按 D1/NOTICE 授权）的 Skill 包校验与渐进披露契约，先在移动端建立安全、只读、数据化的 Skill 管理与问答回合运行时能力，为后续外部知识库接入打牢基础设施，同时保证无 Skill 时既有 P0 与 V0.4 能力零退化。需求追踪（SKM/SKR、EXT-NFR、AC-M2C-10）见 [PRD 10](../../../../docs/prd/10-mobile-skills-and-ima-knowledge.md)，总体架构见 [V0.4/V0.5 扩展设计](../../../../docs/evaluation/mobile-skill-ima-extension-plan-v0.4.md)。

## What Changes

- **移动端 Skill 库管理（「我的 → 技能」，不新增一级 Tab）**：
  - 支持从系统文件选择器导入单个 `SKILL.md` / `.zip` 压缩包，或通过公开 GitHub 仓库/目录/`SKILL.md` URL 获取候选包并固定 commit SHA；
  - 安装前执行有界解析、严格 YAML 与路径/碰撞/zip bomb/大小校验，提供完整预览与兼容性提示，由用户明确确认后原子安装（默认停用）；
  - 提供技能列表、详情（原始 Markdown、版本/来源、资源清单、兼容性与依赖就绪态）、按流程启用与作用域绑定（仅开放 `lf01` 与 `little_tutor`）、受控更新（预览差异并原子切换 active revision）及卸载。
- **持久化升级（SQLite v6 → v7）与备份升级（`format_version: 2`）**：
  - 数据库以原子事务从 v6 升级至 **v7**，新增 `skills`、`skill_revisions`、`skill_bindings` 三张表及索引，并在 `AppStore` 提供 `SkillStore` 纯 TS 仓储契约与内存/Expo SQLite 一致实现；
  - 备份正式升级至 **`format_version: 2`**（`schema_version: 7`，11 张表），完整覆盖有界 Skill 包、绑定及历史收据并排除所有 `SecureStore` 凭据；恢复时严格校验包哈希/路径/引用/容量，恢复后的 Skill 与绑定默认停用；同时完整向后兼容读取历史 **`format_version: 1`（`schema_version: 5` 7 表与 `schema_version: 6` 8 表）** 备份。
- **回合扩展装配与 Runtime 契约加固（LF01 问答与 Dito 小老师）**：
  - 在 `app-host` 引入最小可信工具目录（`ToolCatalog`）、`TurnExtensionResolver` 与 4 个只读 Skill 工具（`list_local_skills`、`load_skill`、`list_skill_files`、`read_skill_file`）；
  - 支持问答/小老师输入框结构化 Skill 选择（每条消息至多 1 个显式 chip，客户端提交 `skillId`，由 Host 记录本轮固定 `revision`）与按需自动发现（遵守 `user-invocable` 与 `disable-model-invocation` 独立标志；自动发现列为 DeepSeek Flash 实测门禁）；
  - 加固 `ChatTurns` 与 `Lf01ChatService` 边界：引入脱敏类型化准备错误 `ExtensionPrepareError`（旧版本缺失/越权/依赖不满足时拒绝发模型请求并引导重选）、分离业务可交付物（`handoffs`/题卡）与扩展收据（`skill_receipts`）、并发工具共享回合原子预算、增量 checkpoint 持久化收据，并确保与既有 `ChatQuickChecks` / `publicChatMessage` 投影无冲突。

### Non-Goals / Out of Scope

- **不做 `ima` 网络连接与外部知识库接入**（归属下一竖切 Change 14：`m2d-ima-knowledge-lf01`，需在完成轻量 PoC 且本 Change 验收归档后再 propose）。
- **不扩展 LF02 精通之路**（归属 Change 15：`m2d-knowledge-mastery`）；不修改 `packages/domain` 任何掌握度、评分、调度或题卡规则。
- **不执行任何包内脚本或动态代码**：无 Shell/Python/Node 执行器、无 `eval`/QuickJS、无 hooks/shell 插值、无通用带密钥 HTTP 工具、无动态插件注册 SDK。
- **不做 Skill 市场/在线发现/发布/对话自动创建与安装、不做多 Agent CRUD、不做远程 MCP、不做云同步或 iOS 专项适配**。
- **不引入新的 Android 原生模块**：复用已有 Expo 原生能力，保持 M3 Release APK 体积与冷启动基线可控。

## Capabilities

### New Capabilities

- `mobile-skill-management`：定义移动端 Skill 包的获取、严格校验、内容哈希版本管理、列表/详情/更新/卸载、兼容性提示，以及安装/启用/能力就绪三态分离的生命周期规则。
- `skill-turn-runtime`：定义 LF01 问答与小老师回合的 Skill 作用域解析、显式选择与按需发现、4 个只读工具授权与回合共享并发预算、类型化准备错误、收据与业务交付物分离以及重试/中断/强杀一致性。

### Modified Capabilities

- `local-storage`：数据库从 SQLite v6 原子升级至 v7（新增 `skills`、`skill_revisions`、`skill_bindings` 表与索引），`AppStore` 新增 `SkillStore` 契约且 `DatabaseSnapshot` 由 8 表扩展为 11 表。
- `local-backup-restore`：备份格式升级为 `format_version: 2`（`schema_version: 7`，11 张表，含 Skill 完整性校验与默认停用策略），同时向后兼容恢复 `format_version: 1` 的 v5（7 表）与 v6（8 表）历史备份。
- `lf01-chat`：更新问答与小老师的工具隔离边界，允许在当前 scope 启用 Skill 时追加注册只读 Skill 工具，无启用 Skill 时保持原有工具白名单（LF01 仅导航工具、小老师为空）且持续严禁写入任何学习证据或掌握状态。

## Impact

- **受影响包**：
  - `packages/infra`：SQLite v6→v7 迁移（`migrations.ts`）、`SkillStore` 接口及 `MemoryAppStore` / `ExpoLearningStore` 实现、11 表 `DatabaseSnapshot` 与 `snapshot.ts`。
  - `packages/app-host`：新增 `src/extensions/{skills,turn-scope,tool-catalog}/`；改造 `chat-turns.ts`、`lf01-chat.ts`、`chat-quick-check.ts`（`publicChatMessage` 保留非敏感扩展元数据）、`app-bootstrap.ts`、`backup-format.ts`、`backup-restore.ts`。
  - `packages/runtime`：仅按需做最小契约核对（不绑定 Skill SDK，不替换 Pi Durable 或引入第二运行时）。
  - `apps/mobile`：「我的」新增技能入口与 `app/settings/skills/*` 子页面；改造 `ChatConversation.tsx`、`chat-controls.tsx`、`BackupCard.tsx` 与 `AppContext.tsx`（重启/恢复重建服务）。
  - `packages/domain`：**无改动**。
- **依赖影响**：仅新增 3 个纯 JS/TS 依赖（与固定子模块 `Cherry Studio Mobile` 一致，零原生 Android 模块）：`yaml`（严格 YAML Frontmatter 解析）、`fflate`（有界流式 ZIP 解压）、`@noble/hashes`（跨 Node/Hermes 的分片流式 `directory-sha256` 内容哈希）。继续复用已有 `expo-document-picker`、`expo-file-system`、`expo-sqlite`、`expo-secure-store`、`expo/fetch`。
- **许可与验证**：实施前核对 `upstream/cherry-studio-mobile` 复用模块的 D1/NOTICE 归属；必须通过 `corepack pnpm typecheck`、`corepack pnpm test`、`openspec validate --all --strict`、DeepSeek Flash 工具调用实测及 Android ARM64 真机验收（对照 M3 基线：APK 38.8 MB、冷启动 225 ms）。
