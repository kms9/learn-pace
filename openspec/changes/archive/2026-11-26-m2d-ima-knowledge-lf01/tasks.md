# Tasks

> 前置：Change 13（`m2d-mobile-skill-management`，SQLite v7 / 备份 v2 11 表）已完成并归档；真实 `ima` 账号 live PoC 实测已完成（见 `docs/evaluation/ima-openapi-poc-report-v0.5.md`）。本 Change 为 **V0.5 / M2-D（Change 14a，只读问答）**，受控上传同步拆分至 Change 14b。不得提前勾选未实测任务。

## 0. 可读路径补充实测（写代码前）

- [x] 0.1 用真实 `ima` 账号在个人库中经 ima 客户端新建 1 篇含独有词的笔记与 1 个含独有词的 `.md` 文件（另放 1 个 `.csv` 与 1 个 `.xlsx` 对照），实测并记录：① 笔记与 Markdown 在 `get_knowledge_list` / `get_media_info` 中的 `media_type` 与字段（笔记是否返回 `notebook_ext_info.notebook_id`、Markdown 是否返回 `url_info` 及下载域）；② `get_doc_content`（`target_content_format: 0`）读取笔记正文与耗时；③ 经 `url_info` + 安全 `X-IMA-*` 头下载 Markdown 正文（`redirect: "error"`）；④ `search_knowledge` 是否能按正文独有词命中及 `highlight_content` 是否非空；⑤ `media_type=5` 下 CSV 与 xlsx 的区分依据。结论追加至 `docs/evaluation/ima-openapi-poc-report-v0.5.md`（零明文凭据、零完整 ID、零签名 URL）；若任一可读路径不成立，先更新 `design.md` 第 3、4 节与 Gate 14 ② 后再继续。

## 1. Android 下载边界小验证与 SQLite v7 → v8 持久化（`packages/infra`）

- [x] 1.1 在 Android 真机的独立探测包验证 `expo/fetch` 的真实 COS 文本下载、302/307 目标零请求、5 MiB 累计截断及 `AbortSignal` 取消。结果见 [PoC 报告 §5](../../../docs/evaluation/ima-openapi-poc-report-v0.5.md#5-task-11-android-下载与流式边界2026-11-26)。
- [x] 1.2 在 `packages/infra/src/migrations.ts` 将 `databaseSchemaVersion` 升级至 `8`，新增事务化 `migrateV8`（`BEGIN IMMEDIATE … COMMIT` 创建 `provider_connections` 与 `source_bindings` 表及索引，`writable` 列预留且本 Change 恒为 `0`，失败完整回滚）；扩充 `packages/infra/src/__tests__/migration-sql.test.ts`，覆盖空库、M1/v4/v5/v6/v7 升级至 v8 以及 v7→v8 中途故障注入回滚。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test packages/infra/src/__tests__/migration-sql.test.ts`。
- [x] 1.3 在 `packages/infra/src/{index,memory,expo,snapshot}.ts` 定义并实现 `KnowledgeStore` 契约（连接与绑定的读写、更新状态、按连接查询与删除）并将 `DatabaseSnapshot` 从 11 表扩展至 13 表；扩充 `packages/infra/src/__tests__/memory-store.test.ts`，验证内存与 SQLite 实现行为一致、事务失败回滚与 13 表快照往返。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test packages/infra/src/__tests__/memory-store.test.ts`。

## 2. 通用只读 `KnowledgeProvider` 与 `ImaProvider`（`packages/app-host`）

- [x] 2.1 新增 `packages/app-host/src/extensions/knowledge/provider.ts`（定义厂商无关的只读 `KnowledgeProvider` 接口与 discriminated union 状态码）及测试用 `FakeKnowledgeProvider`，编写共用合同测试套件 `packages/app-host/src/__tests__/knowledge-provider-contract.test.ts`（覆盖分页、重复 cursor、browse 与 search 区分、已授权库 handle、read 可用性/partial/unsupported、认证/限流/超时/取消与撤权）。
- [x] 2.2 新增 `packages/app-host/src/extensions/knowledge/ima-transport.ts` 与 `ima-provider.ts`：固定 `https://ima.qq.com`、仅允许只读白名单路径（写入路径在发出请求前拒绝）、发送前由 `SecretStore` 注入 `ima-openapi-clientid` / `ima-openapi-apikey`、全部请求 `credentials: "omit"` + `redirect: "error"` 并拒绝 `response.redirected`、兼容 `{ code, msg }` 与 `{ retcode, errmsg }` 以及线上实测字段（`kb_id ?? id`、`kb_name ?? name`、`base_type`、`role_type`、`220030`/`51`/`220001` 错误码）；实现 `probe`/`discover`/`browse`/`search`（最多 3 页、重复 cursor 终止、过滤文件夹）与 `read`（笔记走 `get_doc_content`；文本类走受信 `*.myqcloud.com`/`res-pkb.ima.qq.com` 下载，转发安全 `X-IMA-*` 头、剥离禁转头、不转发 API Key、禁重定向、≤ 5 MiB；`media_type=5` 仅 `.csv` + 文本 `content-type` 可读；PDF/Word/Excel/公众号/订阅库诚实返回 `unsupported`/`content_unavailable`；具体 `media_type` 取值以 Task 0.1 为准）。将 `ImaProvider`（mock transport）接入 `knowledge-provider-contract.test.ts` 跑通共用合同测试。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test packages/app-host/src/__tests__/knowledge-provider-contract.test.ts`。
- [x] 2.3 新增 `packages/app-host/src/extensions/knowledge/knowledge-service.ts`：管理 `ima` 连接创建/凭据轮换（独立 `ima-credentials.<uuid>` 槽位与 `ima-retired-credential-refs` 退役清理）/连通性探测/断开/删除（零远端写副作用）、可访问库发现、绑定与解绑、目录浏览；远端请求不包在 `RestoreGate.write` 内，仅本地写入走带闸门的短事务并在写入前复查连接与绑定仍存在。新增 `packages/app-host/src/__tests__/knowledge-service.test.ts`（含「慢速探测进行中可正常恢复备份」与「恢复后迟到的探测结果不写回」）。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test packages/app-host/src/__tests__/knowledge-service.test.ts`。

## 3. LF01 / Dito 知识库问答运行时、`SourceLedger` 与 Provenance 隔离（`packages/app-host`）

- [x] 3.1 新增 `packages/app-host/src/extensions/knowledge/{source-ledger,knowledge-tools,builtin-ima-skill,provenance}.ts`：
  - `SourceLedger`：为 `knowledge_search` 与 `knowledge_list` 返回的非文件夹文档统一签发本轮不透明 `handleId`（绑定 `bindingId` + `remoteKbId`；文件夹绝不签发），校验 `knowledge_read` 拒绝伪造/跨库/文件夹 handle，仅对有真实可读正文或非空高亮的条目签发 `sourceId`（`S1`…，记录标题、来源类型、`retrievedAt` 与 `@noble/hashes` 计算的 `contentSha256`）并在终态核验回答引用与生成有界离线快照（≤ 1,500 字符，零签名 URL/Header）；
  - `knowledge-tools.ts`：在 `ToolCatalog` 注册 3 个只读知识工具（`knowledge_list`、`knowledge_search`、`knowledge_read`），共享回合原子预算（≤ 4 文档、单文档 ≤ 12,000 字符、总外部正文 ≤ 24,000 字符），预期拒绝返回结构化错误 JSON 不抛异常，并经 `auditMetadata` 增量写入 `knowledge_receipts`；
  - `builtin-ima-skill.ts`：内置移动兼容只读 `ima-knowledge` 标准 Skill 包（最小只读检索/来源策略说明），以 `local_file` / `local:ima-knowledge` 复用 Change 13 `SkillService` 安装/启用/作用域与收据（选库不自动安装或启用）；
  - `provenance.ts`：识别已撤权、已断开或恢复未重连的外部来源消息，为 `boundedHistory`、`promptWithQuotes` 引用芯片、`parentTranscript`、小老师 `selected_text` 与 `ChatQuickChecks`（历史与 `focusExcerpt`）统一提供 `ProvenanceFilter`。
- [x] 3.2 改造 `packages/app-host/src/extensions/turn-scope/`、`lf01-chat.ts`、`chat-turns.ts`、`recovery.ts`、`chat-quick-check.ts`、`knowledge-cards.ts` 与 `app-bootstrap.ts`：
  - `Lf01ChatService.send` / `sendNew` 改为统一可选配置对象并迁移 `apps/mobile` 与既有测试的全部调用方（移除 `skillOrObserver` 二义参数），支持可选知识库选择（`bindingId` + 模式 `kb_only` | `kb_assisted`，Dito 通过 `thread.source_message_id` 继承父回合绑定并复查当前授权）；写入前预解析同时校验显式选中依赖 `knowledge_*` 的 Skill 必须有有效绑定库，否则抛 `ExtensionPrepareError`（`kb_not_configured` / `kb_auth_denied` / `kb_binding_missing` / `dependency_missing`），零写库、不静默换库、不发模型请求；
  - 将 `PrepareTurn.holdText` 接到 `kb_only` 的证据状态。`ChatTurns.generate` 已通过独立回归验证，在 `holdText()` 为真时丢弃正文增量，取得证据后只输出之后生成的正文。新增 `finalizeTurn` 完成引用核验、剥离未知引用标记与 `kb_only` 无可读证据提示。
  - 将 `turn-scope/receipts.ts` 的 `finalizeSkillReceipts` 泛化为同时处理 `skill_receipts` 与 `knowledge_receipts`，`ChatTurns.generate`（取消/失败）与 `RecoveryService`（强杀重启）复用；`boundedHistory` 对「正文为空且仅有收据」回复的跳过规则覆盖 `knowledge_receipts`；
  - `ChatTurns.send` / `repeat`、`boundedHistory` 与 `promptWithQuotes` 新增可选 `ProvenanceFilter` 参数（缺省为恒等），由 `Lf01ChatService` 与 `ChatQuickChecks` 显式传入，`mastery/session-service.ts` 调用点不变；`parentTranscript`、小老师 `selected_text` 同步接入；`ChatQuickChecks.create` 以已撤权来源回复为焦点时拒绝出题；无选库时原问答/小老师/自测/Skill/精通之路语义零变化。
- [x] 3.3 新增 `packages/app-host/src/__tests__/knowledge-qa-runtime.test.ts`，覆盖选库问答（含与教学 Skill / 内置 `ima-knowledge` 组合、`knowledge_list` 浏览文档后直接 `knowledge_read`）、选 `ima-knowledge` 未选库报 `dependency_missing`、未选库零请求、伪造 `mediaId`/文件夹/跨库 handle 拒绝、并发预算防穿透、伪造引用剥离、`kb_only` 首个可读来源前零正文发布与零正文 checkpoint、`kb_only` 无可读正文替换不冒充答案、`kb_assisted` 照常流式、强杀/取消 `knowledge_receipts` 翻态、Dito 继承与不扩权、断开/撤权后 `boundedHistory`/`quotes`/`parentTranscript`/`selected_text`/`ChatQuickChecks` 历史与 `focusExcerpt` 全链路过滤、精通之路会话不受 `ProvenanceFilter` 改动影响，以及对话回合绝不注册写入工具。运行 `corepack pnpm typecheck && corepack pnpm test packages/app-host`。
  - 知识库集成测试应复现模型先输出猜测、工具成功读取后再继续输出的回合，核验界面观察者、checkpoint 与终态均只收到证据到达后生成的正文。

## 4. 备份 `format_version: 2`（`schema_version: 8`, 13 表）与历史兼容（`packages/app-host`）

- [x] 4.1 升级 `packages/app-host/src/backup-format.ts` 与 `backup-restore.ts`：导出 `format_version: 2`、`schema_version: 8`（13 表，强制 `provider_connections.credential_ref = null`、`status = "disconnected"`，排除 `ima-retired-credential-refs` 及一切凭据与签名 URL）；放宽 `format_version === 2` 版本检查以兼容恢复 v2（schema v7 11 表、v8 13 表）与 v1（schema v5 7 表、v6 8 表）；校验 v8 外键引用与零凭据约束；恢复时在 `replaceSnapshot` 清空表前先读取本机 `tx.listProviderConnections()` 收集既有 `ima` `credential_ref` 并并入 `ima-retired-credential-refs`，恢复后所有外部连接保持未连接且**绝不按同 origin 自动复用本机 `ima` 凭据**。
- [x] 4.2 扩充 `packages/app-host/src/__tests__/backup-restore.test.ts`，覆盖 v8 导出零凭据验证、v8 往返恢复不自动复用本机 `ima` 凭据与恢复后 provenance 自动过滤、v1(v5/v6) 与 v2(v7) 向后兼容恢复、篡改连接/孤儿绑定拒绝与故障注入回滚。运行 `corepack pnpm typecheck && corepack pnpm test packages/app-host/src/__tests__/backup-restore.test.ts`。

## 5. 移动端知识库管理与问答引用界面（`apps/mobile`）

- [x] 5.1 新增 `apps/mobile/app/settings/knowledge/{index,ima,[bindingId]}.tsx`，并在 `apps/mobile/app/(tabs)/me.tsx` 与 `apps/mobile/src/context/AppContext.tsx` 接入「知识库」入口与服务重建（不新增一级 Tab）：
  - `P07-K1`：连接列表、状态徽章、已绑定库列表、添加/断开/删除入口；
  - `P07-K2`：数据流向知情说明确认、输入 `Client ID` / `API Key`、测试连接、错误与重连；
  - `P07-K3`：分页发现与搜索库（展示个人/共享/订阅类型）、绑定/解绑、文件夹与文档目录浏览（标注可读/仅元数据）；支持一键安装/启用内置只读 `ima-knowledge` Skill。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 5.2 改造 `apps/mobile/src/components/{ChatConversation,chat-controls,BackupCard}.tsx` 及新增引用卡与来源详情组件：
  - `P02-K`：composer 独立「知识库」chip 选择（单轮至多 1 库）与「仅知识库回答 / 普通问答」开关、检索/阅读过程状态提示（`kb_only` 暂缓正文期间作为主要反馈）；
  - `P02-R`：助手回复下方展示经 Host 校验的引用卡，点击查看离线有界快照与可读限制说明；收藏带外部来源的回复为知识卡或转为学习目标时弹出数据流向确认提示；
  - `BackupCard` 预览展示知识库绑定数与「恢复后外部知识库需重新连接授权」提示。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 6. 全量校验与 Android ARM64 真机验收（Gate 14）

- [x] 6.1 运行全仓静态检查、测试与 OpenSpec 校验：`corepack pnpm typecheck && corepack pnpm test && openspec validate --all --strict`，确认既有 P0、V0.4 与 Change 13 Skill 回归全部通过。
- [x] 6.2 在 Android ARM64 真机（无独立业务后端）完成 **Gate 14（AC-M2C-11-01～06）** 验收，结果记录在 [Android 真机验收](../../../apps/mobile/README.md)。
  - ① 真实 `ima` 账号配置凭据、测试连接、分页发现并记录个人/共享/订阅库权限差异，确认日志/表/备份零凭据泄漏；
  - ② 在自建授权测试库放入本人笔记或 Markdown，独有非敏感事实仅写在正文。提问提供可搜索的标题线索，另在未选库放入反例。对照无库基线与选库回答，核验选库后按标题搜索或浏览目录定位条目、`knowledge_read` 取正文、回答复述独有事实并引用该条目。确认未访问未选库，拒绝以标题命中作为引用依据。
  - ③ 验证 PDF/订阅库（`220030`）在「仅知识库回答」下诚实提示不可读、不冒充答案，且暂缓期间界面不出现无依据正文；
  - ④ 验证 Dito 继承、断网/取消、断开连接后历史可离线看且自动历史/自测/小老师不再外发旧外部正文、v8 备份导出恢复（不自动复用本机 `ima` 凭据）与历史 v5/v6/v7 备份兼容恢复；
  - ⑤ 对比 M3/Change 13 基线记录最新 ARM64 Release APK 体积、冷启动、检索耗时与 `kb_only` / `kb_assisted` 首字耗时至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并真机验收通过后，由主会话归档 `m2d-ima-knowledge-lf01`（同步 `knowledge-provider-ima`、`knowledge-qa-runtime` 为主规格，合并 `local-storage`、`local-backup-restore`、`lf01-chat` 变更）。
- 在 PRD 10 补充受控上传同步的需求编号与验收项后，propose **Change 14b**（受控上传同步：`get_addable_knowledge_base_list` 填写 `writable`、`create_media` + 纯 TS COS `PUT` + `add_knowledge`、`import_urls`，复用本 Change 的连接、绑定与 `RestoreGate` 边界）。
- 归档后再基于稳定的 `KnowledgeProvider` 与 provenance 契约 propose **Change 15（`m2d-knowledge-mastery`）**。
