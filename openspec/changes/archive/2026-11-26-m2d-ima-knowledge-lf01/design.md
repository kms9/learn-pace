# Design

## Context

当前基线为 Change 13（`m2d-mobile-skill-management`）归档后的代码与规格：
- 数据库为 **SQLite v7**（11 张表），备份为 `format_version: 2`（`schema_version: 7`，向后兼容 v1 schema v5/v6）；
- `packages/app-host/src/extensions/` 已建立 `skills/`、`tool-catalog/`、`turn-scope/`，且 `Lf01ChatService` 已完成写入前预解析、`sendNew`、`businessMetadata` / `auditMetadata` 分离、增量 checkpoint 收据合并与 `ExtensionPrepareError`；
- 我们已完成官方 `ima-skills-1.1.10.zip` 拆解与真实 `ima` 账号线上探测（详见 [ima OpenAPI 实测报告](../../../docs/evaluation/ima-openapi-poc-report-v0.5.md)），确认了线上真实字段差异（`search_knowledge_base` 返回 `kb_id`/`kb_name`/`base_type`/`role_type`）、`search_knowledge` 几乎无高亮片段（正文高度依赖 `get_media_info`）、三类库权限矩阵（订阅库 `code: 220030` 拒读）以及 COS 下载域 `skb.ima.myqcloud.com` + 6 个 `X-IMA-*` 安全头；
- **Task 0.1 补测**已确认本人笔记（`media_type=11`）、Markdown（`7`）和 CSV（`5`）的线上原文读取。XLSX 同为 `5`，可通过扩展名和响应 MIME 区分。两轮搜索均可按标题定位样本，正文独有词未命中，返回项高亮为空。第 3、4 节和 Gate 14 ② 按此结果设计；
- 受控上传同步已拆分至 Change 14b，本设计只覆盖只读问答。

## Goals / Non-Goals

**Goals:**
- 以厂商无关的只读 `KnowledgeProvider` 接入 `ima`，不让 LF01 问答硬编码厂商逻辑，通过 fake provider 与 `ima` 共用合同测试证明可扩展性。
- 在 Android 移动端零后端、零新原生模块直连 `https://ima.qq.com` 与受控腾讯云 COS 下载域，实现「连接 → 发现选库 → 目录浏览/检索/笔记与文本原文读取 → 带核验引用回答」闭环。
- 严格隔离密钥（`SecureStore` 独占、零外泄至模型/日志/收据/备份）与外部来源 provenance（撤权或恢复未重连后阻止历史外部正文经普通问答、小老师或自测出题自动外发）。
- 无知识库绑定或未选库时，既有 P0、V0.4 与 Change 13 Skill 能力保持 100% 原有语义。

**Non-Goals:**
- 不在移动端实现本地 PDF/DOCX/PPTX 二进制解析或本地向量 RAG。
- 不接入 LF02 精通之路（Change 15），不修改 `packages/domain`。
- 不提供任何远端写操作（上传文件、导入 URL、删除/覆写远端文件），受控上传同步属于 Change 14b；不在对话回合向模型暴露上传或写入工具。
- 不直接执行官方 `ima-skills` 中的 `.cjs` 脚本。

## Decisions

### 1. 只读 `KnowledgeProvider` 契约

```ts
export type KnowledgeStatus =
  | "ready"
  | "partial"
  | "no_matches"
  | "not_configured"
  | "auth_denied"
  | "rate_limited"
  | "content_unavailable"
  | "unsupported"
  | "network_error"
  | "timeout"
  | "cancelled";

export interface KnowledgeProvider {
  readonly providerId: string; // e.g. "ima"
  probe(input: { connectionId: string; signal: AbortSignal }): Promise<ProbeLibraryResult>;
  discover(input: { connectionId: string; query?: string; cursor?: string; limit?: number; signal: AbortSignal }): Promise<DiscoverResult>;
  browse(input: { binding: StoredSourceBinding; folderId?: string; cursor?: string; limit?: number; signal: AbortSignal }): Promise<BrowseResult>;
  search(input: { binding: StoredSourceBinding; query: string; topK: number; signal: AbortSignal }): Promise<SearchResult>;
  read(input: { binding: StoredSourceBinding; handle: VerifiedSourceHandle; signal: AbortSignal }): Promise<ReadResult>;
}
```

- 所有返回结果均为 discriminated union（含明确 `status` 与脱敏 `message`），绝不以空数组掩盖认证失败、限流或网络故障。
- 本 Change 不定义写入契约；Change 14b 另行新增独立的 `KnowledgeWriteProvider`，且只供「我的 → 知识库」管理服务使用。问答回合的 `TurnExtensionResolver` 仅消费只读 `KnowledgeProvider`，从类型与架构上杜绝模型在对话中触发远端写操作。

### 2. SQLite v7 → v8 原子迁移与 `KnowledgeStore`（`packages/infra`）

- `databaseSchemaVersion` 由 `7` 升至 `8`，`migrateV8(db)` 包裹在 `BEGIN IMMEDIATE … COMMIT`（失败回滚，沿用故障注入验证）：
  ```sql
  CREATE TABLE IF NOT EXISTS provider_connections (
    connection_id TEXT PRIMARY KEY NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('ima')),
    display_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('disconnected', 'ready', 'auth_denied', 'error')),
    credential_ref TEXT,
    last_error TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_bindings (
    binding_id TEXT PRIMARY KEY NOT NULL,
    connection_id TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('ima')),
    remote_kb_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    base_type TEXT NOT NULL DEFAULT '',
    role_type TEXT NOT NULL DEFAULT '',
    writable INTEGER NOT NULL DEFAULT 0 CHECK (writable IN (0, 1)),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS source_bindings_connection_kb_unique
    ON source_bindings (connection_id, remote_kb_id);
  CREATE INDEX IF NOT EXISTS source_bindings_by_connection
    ON source_bindings (connection_id, updated_at DESC);

  PRAGMA user_version = 8;
  ```
- **`writable` 列预留**：本 Change 不调用 `get_addable_knowledge_base_list`，`writable` 恒写 `0` 且不在界面展示；保留该列使 Change 14b 无需再迁移至 v9，由 14b 负责填写真实值。
- **凭据槽位与退役清理**：每个连接生成独立 `credential_ref = "ima-credentials.<uuid>"`，在 `SecureStore` 中保存 `{ clientId, apiKey }` JSON；表与日志/备份永不存明文凭据。退役槽位沿用 `model-settings.ts` 同款机制（存 `ima-retired-credential-refs` 私有 setting，备份导出过滤，新凭据保存成功或显式删除连接后清理旧槽位）。
- `DatabaseSnapshot` 扩展至 **13 张表**（原 11 表 + `provider_connections`、`source_bindings`）；`MemoryAppStore` 与 `ExpoLearningStore` 保持 100% 行为一致。

### 3. `ImaTransport`、`ImaProvider` 与实测契约适配（`packages/app-host/src/extensions/knowledge/`）

- **固定 Origin 与凭据隔离**：
  - 仅允许向固定 `https://ima.qq.com` 发送只读白名单路径：`/openapi/wiki/v1/{search_knowledge_base,get_knowledge_base,get_knowledge_list,search_knowledge,get_media_info}` 与 `/openapi/note/v1/get_doc_content`；禁止复用模型设置网关。写入路径（`get_addable_knowledge_base_list`、`check_repeated_names`、`create_media`、`add_knowledge`、`import_urls`）不在本 Change 白名单内，transport 对其直接拒绝。
  - 所有请求使用 `credentials: "omit"` 和 `redirect: "error"`，额外拒绝 `response.redirected === true` 的响应。Task 1.1 在 Android 上确认 302 与 307 均被拒绝且目标零请求。允许跟随的对照成功抵达目标，但最终响应的 `redirected` 为 `false`，因此以请求选项阻止重定向。
  - 凭据仅在 `ImaTransport` 发送前从 `SecretStore` 按 `credential_ref` 现场读取并注入 `ima-openapi-clientid` / `ima-openapi-apikey`（可选 `ima-openapi-ctx: app=learn-pace`），绝不传入模型、日志、错误消息或 `RuntimeEvent`。
- **Envelope 与错误码映射（融合 DeepTutor + 线上实测）**：
  - 兼容 `{ code, msg, data }` 与 `{ retcode, errmsg, data }` 两种拼写；HTTP 非 2xx 永不按 `code=0` 放行。
  - 错误映射：HTTP 401/403 或业务码 `20004`/`200002` → `auth_denied`；HTTP 429 或 `20002`/`110021` → `rate_limited`；`110010`/`100003` → `network_error`（可重试）；`220030`（含订阅库拒读 / AI 会话不可读）→ `content_unavailable`（保留脱敏提示）；`51`/`110001`/`220001` → 参数错误；`AbortSignal` → `cancelled`。
- **线上字段适配（来自实测报告）**：
  - `search_knowledge_base` 兼容解析 `kb_id ?? id`、`kb_name ?? name`，保留 `base_type`、`role_type`、`content_count`、`description`；
  - `search_knowledge` 在 `is_end`/`next_cursor` 缺失时处理当前 `info_list` 即结束。有分页时最多 3 页，检测到重复 cursor 即停止。两轮实测的命中项高亮均为空，应按标题线索定位文档，搜索结果缺正文时只提供文档元数据与读取 handle。
  - `browse`（`get_knowledge_list`）明确区分文件夹与文档，返回面包屑 `current_path` 与分页状态。详情响应可能省略 `media_id`，后续读取及来源记录沿用目录或搜索条目中的稳定 ID。
- **受控原文读取（`read`）**：
  - `media_type === 11` 的笔记通过详情的 `notebook_ext_info.notebook_id` 取得 `note_id`，调用 `/openapi/note/v1/get_doc_content`（`target_content_format: 0`），取 `data.content` 纯文本并截断至 12,000 字符。Task 0.1 验证本人笔记可读，其他作者笔记按接口权限结果返回对应状态。
  - 文本资源从详情的 `url_info` 获取短时下载 URL。Task 0.1 实测 Markdown 为 `7`、CSV 为 `5`，TXT / HTML / JSON 未取样。强制校验 HTTPS + Host 白名单（`res-pkb.ima.qq.com` 或 `*.myqcloud.com`），本轮实测域为 `skb.ima.myqcloud.com`。仅转发 `url_info.headers` 中的安全头（如 `X-IMA-*`），剥离 `connection`/`content-length`/`cookie`/`host`/`proxy-authorization`/`transfer-encoding`，**严禁携带 `ima-openapi-apikey`**。使用 `redirect: "error"` 并拒绝 `response.redirected`，同时校验 `content-length` 与流式读取累计字节 ≤ **5 MiB**，UTF-8 解码后截断至 12,000 字符（HTML 做轻量标签清洗）。
  - **`media_type=5` 消歧**：该值同时覆盖 CSV 与 xls/xlsx。仅当标题扩展名为 `.csv` 且响应 `content-type` 为 `text/csv` 或 `text/plain` 时按文本读取；其余（含扩展名缺失、`.xls`/`.xlsx`、二进制 `content-type`）一律返回 `unsupported`，下载过程中检测到非 UTF-8 文本同样中止并返回 `unsupported`；
  - 下载使用可主动中止的 `AbortController`，并接收调用方的取消信号。声明长度超限时在读取正文前中止，流读取超限时在追加该数据块前中止。Task 1.1 在 Android 上验证了响应头前取消与正文读取中取消，服务端均观察到连接提前关闭。
  - `media_type ∈ {1(PDF), 3(Word), 4(PPT), 5(xls/xlsx), 6(公众号), 9(图片), 12(AI会话), 14, 15, 16, 21}` 或无 `url_info` / `code: 220030`：诚实返回 `unsupported` 或 `content_unavailable`（附清晰说明，绝不伪造正文或把标题冒充原文）。
- **网络请求与 `RestoreGate` 的边界**：`knowledge-service.ts` 的探测、发现、浏览等远端请求**不**包在 `RestoreGate.write` 内（否则慢请求会让恢复备份直接报错）；仅在拿到结果后，以带闸门的短事务写入 `provider_connections` / `source_bindings`，写入前复查连接与绑定仍存在且未在期间被恢复替换。问答回合内的知识工具请求沿用 `ChatTurns.exclusively` 既有的整轮闸门语义，与模型请求一致。

### 4. LF01 / Dito 知识库问答运行时、`SourceLedger` 与 Provenance 隔离

- **回合作用域、参数签名与组合规则**：
  - 用户在 composer 通过独立的「知识库」chip 选择**至多 1 个**已绑定且连接就绪的库（`bindingId`），并可选择回答模式：`kb_only`（「仅知识库回答」）或 `kb_assisted`（「普通问答，结合知识库」）；不选库时不注册任何知识工具、不发 `ima` 请求。
  - `Lf01ChatService.send` 与 `sendNew` 改为统一的可选配置对象（`{ skillId?, knowledge?: { bindingId, mode }, onMessage?, onSession? }`），**不再叠加第三种位置参数重载**；同一 Change 内迁移 `apps/mobile` 与既有测试的全部调用方，移除现有 `skillOrObserver` 二义参数。
  - **Dito 继承与查询路径**：小老师通过 `thread.source_message_id` 读取父会话锚点回合的 `user.metadata.knowledge_selection`（或 `reply.metadata.knowledge_provenance`）获取继承的 `bindingId` 并在预解析时复查当前连接与绑定是否仍有效；若父轮已删除（`detached_at !== null`）或原回合未绑定库则默认不继承，且绝不扩大到未选库。
  - **写入前预解析与重试恢复**：延续 Change 13 架构，`Lf01ChatService` 在写入消息前校验 `bindingId` 与所属连接状态；若连接已断开/凭据缺失/绑定已删除，抛出类型化 `ExtensionPrepareError`（新增错误码：`kb_not_configured`、`kb_auth_denied`、`kb_binding_missing`），不写半轮、不发模型请求。`retry`/`regenerate` 永不改写历史 `user.metadata.knowledge_selection`，失败时原回复保持不变，界面提供「前往重新连接」或「以普通问答重新发送」（回填原正文与引用、去掉失效库 chip，由用户确认发送）。
- **内置移动兼容 `ima-knowledge` Skill 与工具目录（含回合级依赖门禁）**：
  - `ToolCatalog` 新增 3 个只读知识工具能力：`knowledge_list`、`knowledge_search`、`knowledge_read`（对话回合绝不注册上传工具）；
  - 应用提供内置只读 `ima-knowledge` 标准包，沿用 `origin_kind: "local_file"` / `origin_locator: "local:ima-knowledge"` 经既有 `SkillService` 安装启用（不修改 `skills` 表 CHECK 约束与 `backup-format.ts` Skill 校验逻辑）；**选库本身不自动安装/启用任何 Skill**，未启用该 Skill 时仍可通过 Host 基础知识库指令与工具完成问答（不记录虚假 Skill 收据）；同一授权库也可与费曼/苏格拉底等教学 Skill 组合使用。
  - **回合级依赖校验**：`TurnExtensionResolver.resolve()` 除静态 `ToolCatalog` 外，还校验本轮实际可用能力——若显式选中的 Skill 声明依赖 `knowledge_*` 工具而本轮未选定有效知识库，直接抛出 `ExtensionPrepareError("dependency_missing")`（提示「请先选择一个已绑定的知识库」），避免模型无工具空跑。
- **`SourceLedger`、后置引用核验与收据收口**：
  - `ima-knowledge` 与 Host 基础指令引导模型按标题线索调用 `knowledge_search`，匹配过宽或缺少标题线索时用 `knowledge_list` 浏览目录。按 Task 0.1 实测的路径取得条目后，通过 `knowledge_read` 获取原文再据此回答与引用。搜索收据标明「无正文高亮」，正文读取失败时按实际结果提示。
  - 每轮维护独立 `SourceLedger`：对 **`knowledge_search` 与 `knowledge_list` 返回的非文件夹文档条目**统一分配本轮不透明 `handleId`（仅限当前轮、绑定当前 `bindingId` 与 `remoteKbId`；文件夹条目绝不签发 handle）。`knowledge_read` 仅接受当前 `SourceLedger` 中的已验证 `handleId`，拒绝模型伪造任意 `mediaId`、URL 或跨库 ID；
  - 仅对**包含真实可读正文或非空高亮片段**且具有稳定 `media_id` 的条目分配可引用 `sourceId`（如 `S1`、`S2`），目录与仅标题匹配条目不可成为已验证引用；每个 `sourceId` 记录 `{ sourceId, bindingId, remoteKbId, mediaId, title, sourceType, retrievedAt, contentSha256 }`（PRD 10 QA-05；`contentSha256` 以 `@noble/hashes` 对实际交给模型的正文计算），用于引用卡展示与历史快照一致性核对；
  - 每轮共享预算：最多读取 **4 个文档**、单文档 ≤ **12,000 字符**、总外部证据正文 ≤ **24,000 字符**（同步原子预留，防并发工具穿透）；所有返回正文包裹不可信数据边界标记防提示注入；
  - **`kb_only` 丢弃获得证据前的正文**。`PrepareTurn` 提供可选 `holdText?: () => boolean`。首个可读 `sourceId` 可供模型使用前，`ChatTurns.generate` 直接丢弃 `text_delta`，正文累积、观察者与 checkpoint 均不接收这段文本。期间仍可保存收据，界面依据 `onToolActivity` 与 `knowledge_receipts` 展示「正在检索 / 正在阅读」。获得证据后从下一条新生成的正文增量开始流式输出，终态也只使用获得证据后的正文。`kb_assisted` 与无库回合沿用默认流式行为。
  - **终态后置钩子（`PrepareTurn.finalizeTurn`）**：在 `ChatTurns.generate` 落盘 `terminal` 前调用 `finalizeTurn({ content, status })` 并以其返回的 `{ content, metadata }` 覆盖：① 核验 `content` 中的 `[S1]`/`[S2]` 标记，仅将 `SourceLedger` 中已验证可读条目写入 `citations` 与有界离线快照（每条快照 ≤ 1,500 字符，不含签名 URL 或原始 Header），未知标记从正文中剥离；② 在 `kb_only` 模式下若 `SourceLedger` 有效可读证据为 0，正文替换为明确提示「当前知识库未找到可读正文，请调整问题或切回普通问答」（附不可读原因汇总），因 `holdText` 已阻止中间发布，用户不会先看到被替换的无依据回答。
  - **`knowledge_receipts` 结构与收口**：每次知识工具调用经 `auditMetadata` 增量 checkpoint 写入 `reply.metadata.knowledge_receipts: { tool: "knowledge_list" | "knowledge_search" | "knowledge_read"; bindingId; status: "started" | "succeeded" | "failed" | "interrupted" | "unknown"; resultStatus?: KnowledgeStatus; sourceIds?: string[]; startedAt; finishedAt? }[]`，不含远端 `media_id`、下载 URL 或 Header。将 `turn-scope/receipts.ts` 的 `finalizeSkillReceipts` 泛化为同时处理 `skill_receipts` 与 `knowledge_receipts`，`ChatTurns.generate`（取消/失败）与 `RecoveryService`（强杀重启）复用同一函数把 `started` 翻为 `interrupted` / `unknown`；`boundedHistory` 跳过「正文为空且仅有收据」回复的规则同步覆盖 `knowledge_receipts`。
- **全链路 Provenance 隐私隔离（覆盖 `quotes`、小老师选文与 M2-C 入口）**：
  - 凡使用过外部知识库并产生来源/引用的回合，在 `message.metadata.knowledge_provenance` 持久化 `{ bindingId, connectionId, provider, remoteKbId }`；
  - 每轮在 `exclusively` 内计算当前有效的已授权 `bindingId` 集合，构造统一的 `ProvenanceFilter` 覆盖全部 5 条自动上下文路径：
    1. `boundedHistory`（主问答与 `ChatQuickChecks` 自测出题共用）：撤权/断开/恢复未重连的外部来源助手回复替换为脱敏占位文本（`[已撤销外部知识库来源的历史回答，默认不再次发送给模型]`）；
    2. `promptWithQuotes`（`user.metadata.quotes`）：若某条引用的 `source_message_id` 指向已撤权外部来源消息，同步替换为脱敏占位，防止通过引用芯片二次外发；
    3. `parentTranscript`（小老师父会话上下文）：同口径脱敏替换；
    4. 小老师 `thread.selected_text`：若 `thread.source_message_id` 指向已撤权外部来源消息，在用户切回普通追问时同步脱敏替换（本地界面仍可离线浏览与删除历史）；
    5. `ChatQuickChecks.create` 的 `focusExcerpt`（当前直接取来源回复 `source.content`）：来源回复属于已撤权外部来源时，拒绝以其为焦点出题并提示「该回复来自已断开的知识库，请先重新连接或从其他回复发起自测」，不以脱敏占位出题。
  - **注入方式（不影响精通之路）**：`ChatTurns` 同时被 `mastery/session-service.ts` 使用。`ChatTurns.send` / `repeat` 新增可选参数 `filter?: ProvenanceFilter`，未传入时等价于恒等过滤；`boundedHistory(messages, perMessage, filter?)` 与 `promptWithQuotes(message, filter?)` 同步增加可选参数。`Lf01ChatService` 与 `ChatQuickChecks` 显式传入，精通之路调用点保持不变。
  - 用户主动将带外部来源的回复点「收藏为知识卡」或「转为学习目标」时，弹出明确数据流向提示，经用户知情确认后方可复制保存。

### 5. 备份 `format_version: 2`（`schema_version: 8`）与兼容矩阵

- 导出：`format_version: 2`、`schema_version: 8`、13 张表；`provider_connections` 强制 `credential_ref: null`、`status: "disconnected"`、`last_error: null`；`manifest.counts` 新增 `provider_connections`、`source_bindings`；继续排除 `ima-retired-credential-refs` 与全部 `SecureStore` 槽位；总上限保持 20 MiB。
- 导入：接受 `format_version: 2`（`schema_version: 8` 13 表与 `schema_version: 7` 11 表，需放宽 `backup-format.ts` 中 `format_version === 2` 的版本号校验）及历史 `format_version: 1`（`schema_version: 5` 7 表与 `schema_version: 6` 8 表）；先按原始 `{ manifest, payload }` 验 SHA-256，再归一化缺失表为空数组；校验 `provider_connections` 不含任何非空 `credential_ref`、排除 `ima-retired-credential-refs` 且 `source_bindings` 引用有效连接；**在 `replaceSnapshot` 清空表之前先读取本机 `tx.listProviderConnections()` 收集既有 `ima` `credential_ref` 并并入 `ima-retired-credential-refs` 写入恢复后的 `settings`**（保留本机旧凭据不泄漏为孤儿，待重配新凭据后清理），**绝不按同 origin 自动复用本机 `ima` 凭据**。

## Risks / Trade-offs

- **[Risk] 线上可读范围受文件类型和库权限限制**
  - *Mitigation*：本人笔记、Markdown、CSV 已经 Task 0.1 实测。界面在库详情、检索收据与「仅知识库回答」空态中区分可读正文和仅有元数据的条目，按实际权限解释拒读结果。
- **[Risk] 正文词搜索可能无法定位文档**
  - *Mitigation*：Task 0.1 的正文独有词均未命中。按第 4 节从标题或目录定位，再读原文。Gate 14 ② 提供可检索的标题线索，独有事实仅出现在正文。
- **[Risk] Android 下载的响应标志和缓冲行为**
  - *Mitigation*：Task 1.1 已在真机验证真实 COS 文本下载、302/307 拒绝、5 MiB 边界和主动取消。按第 3 节设置阻断重定向并在超限时中止连接。
- **[Risk] `kb_only` 暂缓推送正文使首字时间变长**
  - *Mitigation*：暂缓期间展示检索/阅读进度（PRD 10 QA-04），Gate 14 ⑤ 记录 `kb_only` 与 `kb_assisted` 的首字耗时对比。
- **[Risk] 撤权后用户仍可能手动复制文本粘贴发送**
  - *Mitigation*：Host 层保证全部 5 条自动上下文注入路径 100% 过滤已撤权外部来源，并对收藏知识卡/转为学习目标提供显式知情提示；按 PRD 10 EXT-NFR-09 诚实声明不保证识别人工复制粘贴文本。
