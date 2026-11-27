# Proposal

## Why

Change 13（`m2d-mobile-skill-management`）已完成并归档，移动端已具备安全的 Skill 包管理、作用域装配、回合共享预算与审计收据能力；同时我们已完成官方包 `ima-skills-1.1.10.zip` 拆解与真实 `ima` 账号全链路只读 PoC 实测（见 [ima OpenAPI 实测报告](../../../docs/evaluation/ima-openapi-poc-report-v0.5.md)）。

本 Change 作为 **V0.5 / M2-D（Change 14a）**，面向学习者「直接使用已有 `ima` 外置知识库、不在本地重复建设重型素材库与 PDF 解析器」的明确诉求，建立厂商解耦的通用只读 `KnowledgeProvider` 抽象并接入首个外部知识服务 **`ima`**，聚焦**基于 `ima` 的 LF01 问答与 Dito 小老师追问**：连接账号、发现与绑定授权库、浏览目录、检索、按 `get_media_info` 读取笔记与文本原文、生成经 Host 校验的带引用回答与离线快照，并在撤权或备份恢复后阻断旧外部来源自动外发。

移动端受控上传同步到 `ima`（本地文件直传腾讯云 COS、网页/公众号 `import_urls`）与 PRD 10 当前「只读、不创建 ima 内容」的边界冲突，且与只读问答在风险与价值上相互独立，**拆分至后续 Change 14b**，待 PRD 10 补充对应需求编号与验收项后再 propose。

产品需求与验收基准见 [PRD 10](../../../docs/prd/10-mobile-skills-and-ima-knowledge.md)（KB/IMA/QA、AC-M2C-11），技术框架见 [V0.4/V0.5 扩展设计](../../../docs/evaluation/mobile-skill-ima-extension-plan-v0.4.md) §5–6 与 §10.4。

## What Changes

- **通用 `KnowledgeProvider` 抽象与 `ima` 适配器（无独立业务后端、零新增原生模块）**：
  - 定义厂商无关的 `KnowledgeProvider` 只读契约（`probe` / `discover` / `browse` / `search` / `read`，discriminated union 结构化状态），通过 fake provider 与 `ima` mock transport 共用合同测试验证解耦；
  - 实现直连 `https://ima.qq.com` 的 `ImaProvider`：凭据（`Client ID` / `API Key`）仅存 `SecureStore` 并由 transport 注入；兼容线上实测 `search_knowledge_base` 返回 `kb_id`/`kb_name` 与 `get_knowledge_base`、`get_knowledge_list`、`search_knowledge`、`get_media_info`、`/openapi/note/v1/get_doc_content`；
  - **原文读取契约（基于实测边界，开工前补充实测笔记与 Markdown 可读性）**：笔记（`media_type=11`）走 `get_doc_content` 读纯文本；Markdown/TXT/CSV/HTML/JSON 走受控 HTTPS 下载（严格白名单 `*.myqcloud.com` / `res-pkb.ima.qq.com`，转发安全 `X-IMA-*` 头、剥离敏感头、禁重定向、禁转发 `ima-openapi-apikey`、单文件 ≤ 5 MiB、可取消）；对 PDF/Word/PPT/Excel/公众号及订阅库（`code: 220030`）诚实返回 `unsupported` / `content_unavailable`，**不在移动端实现本地 PDF/DOCX 解析**。
- **持久化升级（SQLite v7 → v8）与备份扩展（`format_version: 2`, `schema_version: 8`, 13 表）**：
  - 原子迁移新增 `provider_connections` 与 `source_bindings` 表及 `KnowledgeStore` 仓储；
  - 备份导出 13 张表，强制 `credential_ref: null` 与断开态，严禁导出任何 `ima` 密钥或签名下载 URL；向后兼容恢复 `format_version: 1`（schema v5/v6）与 `format_version: 2`（schema v7）；恢复后全部外部连接需用户显式重连与重新确认库，绝不按同 origin 自动复用本机 `ima` 凭据。
- **LF01 与 Dito 知识库问答运行时、移动兼容 `ima-knowledge` Skill 与 Provenance 隔离**：
  - 在 `ToolCatalog` 注册 3 个只读知识工具（`knowledge_list`、`knowledge_search`、`knowledge_read`），仅当本轮用户显式选定已绑定知识库时启用（单轮选 1 个库，不选库不发 `ima` 请求；对话回合绝不暴露任何上传/写入工具）；
  - 提供内置、移动兼容、只读的 `ima-knowledge` 标准 Skill（复用 Change 13 的安装/启用/作用域/收据机制，选库不自动安装/启用 Skill 且不绕过 invocation 标志）；
  - Host 维护每轮 `SourceLedger`（映射到不透明 `sourceId`、`read` 只消费本轮已授权库内的已验证 handle、回答提交前校验引用、保存有界离线来源快照），区分「仅知识库回答」与「普通问答」；
  - 「仅知识库回答」模式在本轮取得可读证据前仅展示检索与阅读进度，丢弃此前生成的正文。取得证据后从新生成的增量开始流式输出。
  - 统一 provenance 过滤：当知识库连接断开/撤权或备份恢复未重连时，`boundedHistory`、引用芯片、`parentTranscript`、小老师选文与 `ChatQuickChecks` 出题（含 `focusExcerpt`）默认过滤/脱敏占位受影响的外部来源消息，不自动二次外发；将带外部来源的回复收藏为 `knowledge_cards` 时展示明确数据流向提示由用户确认。
- **移动端管理与问答界面（不新增一级 Tab）**：
  - 「我的 → 知识库」（`P07-K1/K2/K3`）：数据流向知情确认、添加/测试/重连/断开 `ima`、分页发现与绑定/解绑库、库目录浏览；
  - 问答与小老师 composer（`P02-K`）与引用详情（`P02-R`）：独立「知识库」chip 选择、「仅知识库回答 / 普通问答」切换、检索/阅读进度、可核验来源卡与离线快照查看。

### Non-Goals / Out of Scope

- **不接入 LF02 精通之路**（归属下一竖切 Change 15：`m2d-knowledge-mastery`，待本 Change 验收归档后再 propose）；不修改 `packages/domain`。
- **不在移动端自建本地知识库/向量 RAG 或本地 PDF/DOCX/PPTX 二进制文本解析器**。
- **不提供任何远端写操作**：不上传文件、不导入 URL、不删除/覆写/编辑远端 `ima` 文档、不写 `ima` 笔记（`import_doc`/`append_doc`）；受控上传同步（`create_media` / COS `PUT` / `add_knowledge` / `import_urls`）整体移至 **Change 14b**，需先在 PRD 10 补充需求编号与验收项。
- **不执行官方 `ima-skills` 中的任何 `.cjs` 脚本**，不引入远程 MCP、其他知识库厂商实现或云同步。
- **不引入新的 Android 原生模块**：复用已有 `expo/fetch` 与 `expo-secure-store`。

## Capabilities

### New Capabilities

- `knowledge-provider-ima`：定义厂商解耦的只读 `KnowledgeProvider` 契约、`ima` 凭据隔离连接管理、多类型库发现与绑定、目录浏览/检索/原文读取（按实测支持笔记与文本、诚实标注不可解析/订阅拒读）。
- `knowledge-qa-runtime`：定义 LF01 与 Dito 小老师的知识库回合作用域、只读知识工具与共享预算、内置只读 `ima-knowledge` Skill、`SourceLedger` 不透明 `sourceId` 引用核验与离线快照、「仅知识库回答」语义（含读到正文前不推送正文）以及撤权/恢复后的全链路 provenance 隔离。

### Modified Capabilities

- `local-storage`：数据库从 SQLite v7 原子升级至 v8（新增 `provider_connections`、`source_bindings` 表与索引），`AppStore` 新增 `KnowledgeStore` 契约且 `DatabaseSnapshot` 从 11 表扩展至 13 表。
- `local-backup-restore`：备份保持 `format_version: 2`、升级至 `schema_version: 8`（13 张表，零凭据导出、恢复后强制未连接且不自动复用本机 `ima` 凭据），向后兼容恢复 v1（schema v5/v6）与 v2（schema v7）。
- `lf01-chat`：更新问答与小老师工具隔离边界，允许在回合绑定已授权知识库时追加注册 3 个只读知识工具（绝不注册上传/写入工具），无库时保持既有语义且严禁写入任何学习证据或掌握状态。

## Impact

- **受影响包**：
  - `packages/infra`：SQLite v7→v8 迁移（`migrations.ts`）、`KnowledgeStore` 契约及 `MemoryAppStore` / `ExpoLearningStore` 实现、13 表 `DatabaseSnapshot` 与 `snapshot.ts`。
  - `packages/app-host`：新增 `src/extensions/knowledge/`（`provider.ts`、`ima-transport.ts`、`ima-provider.ts`、`knowledge-service.ts`、`source-ledger.ts`、`knowledge-tools.ts`、`builtin-ima-skill.ts`、`provenance.ts`）；更新 `tool-catalog/`、`turn-scope/`（含收据泛化）、`chat-turns.ts`、`lf01-chat.ts`、`recovery.ts`、`chat-quick-check.ts`、`knowledge-cards.ts`、`app-bootstrap.ts`、`backup-format.ts`、`backup-restore.ts`。
  - `packages/runtime`：保持零厂商绑定（仅复用既有 `RuntimeTool`、`AbortSignal` 与 `allowedTools`）。
  - `apps/mobile`：新增 `app/settings/knowledge/{index,ima,[bindingId]}.tsx`；更新 `app/(tabs)/me.tsx`、`src/context/AppContext.tsx`、`src/components/{ChatConversation,chat-controls,BackupCard}.tsx` 及新增引用卡与来源详情弹层组件。
  - `packages/domain`：**无改动**。
- **依赖影响**：**零新增依赖、零新增 Android 原生模块**（`SourceLedger` 内容 hash 复用 `packages/app-host` 已安装的 `@noble/hashes`）。
- **验证要求**：开工前补充实测笔记/Markdown 原文读取与正文检索命中；通过 `corepack pnpm typecheck`、`corepack pnpm test`、`openspec validate --all --strict`、fake provider + ima mock 合同测试，以及 Android ARM64 真机验收（覆盖真实 `ima` 测试库闭环、独有事实检索引用对照、反例防跨库、断网/撤权/恢复与 M3 基线对比）。
