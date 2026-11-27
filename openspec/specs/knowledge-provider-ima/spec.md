# knowledge-provider-ima Specification

## Purpose

定义移动端外部知识库的通用只读接入契约及 ima 实现，覆盖凭据隔离、授权库发现与绑定、目录浏览、检索、正文读取及取消。规范无法读取的内容与权限错误的反馈，以及断开连接和撤权后的行为。

## Requirements

### Requirement: Vendor-agnostic KnowledgeProvider and isolated IMA connection
应用 SHALL 通过厂商无关的 `KnowledgeProvider` 接口（`probe`、`discover`、`browse`、`search`、`read`，返回带明确状态码的结构化结果，不以空数组掩盖故障）接入外部知识库，并通过 fake provider 与 `ima` mock transport 共用合同测试证明无厂商硬编码。配置 `ima` 连接前 MUST 展示数据流向知情说明并由用户确认；`Client ID` 与 `API Key` MUST 独占存于 `SecureStore`（表内仅存 `credential_ref`），固定直连 `https://ima.qq.com`，禁止复用模型网关或向模型、日志、消息、收据及备份暴露凭据。

#### Scenario: Connect IMA account and discover accessible libraries
- **WHEN** 用户在「我的 → 知识库」确认数据流向，输入合法 `Client ID` 与 `API Key` 并测试连接成功，随后分页浏览可访问知识库
- **THEN** 凭据写入 `SecureStore`，连接状态更新为就绪，应用正确解析 `kb_id`/`kb_name`、`base_type` 与 `role_type` 并分页展示个人库、共享库与订阅库
- **AND** 凭据从未出现在数据库表、日志或错误消息中；仅用户明确勾选保存的库生成本地 `SourceBinding`

#### Scenario: Distinguish authentication, rate-limit, and network failures
- **WHEN** `ima` 返回 HTTP 401/403 或业务码 `20004`/`200002`、HTTP 429 或 `20002`/`110021`，或发生断网/超时
- **THEN** Provider 返回对应的结构化状态（`auth_denied`、`rate_limited`、`network_error`、`timeout`）与脱敏提示，不以空列表伪装查询成功

### Requirement: Scoped browsing and search
应用 SHALL 仅针对用户已授权绑定的 `SourceBinding` 调用 `get_knowledge_list` 分页浏览和 `search_knowledge` 搜索。浏览区分文件夹与文档。搜索最多 3 页，响应无分页游标时结束，遇到重复游标立即终止。文件夹和仅有标题元数据的命中项 MUST NOT 作为正文证据。

#### Scenario: Browse folders and search for document titles in a bound library
- **WHEN** 应用浏览已绑定库的文件夹，或按标题线索搜索文档
- **THEN** 目录保留文件夹与文档的区别及分页状态，搜索只将文档返回为候选，空高亮项按元数据显示，重复游标或缺少游标时结束请求

### Requirement: Verified resource reading and explicit unavailable states
`read` MUST 仅消费本轮已验证的文档 handle。笔记（`media_type=11`）通过 `/openapi/note/v1/get_doc_content` 读纯文本。Markdown、TXT、CSV、HTML、JSON 通过受控下载读取。对 PDF、Word、PPT、Excel、公众号及订阅库拒读（`code: 220030`）MUST 返回 `unsupported` 或 `content_unavailable`，并提示原因。

#### Scenario: Read an IMA note and a Markdown document from a bound library
- **WHEN** 用户绑定的库包含当前账号具备正文权限的笔记（`media_type=11`）与 Markdown（`media_type=7`），系统按已验证 handle 读取原文
- **THEN** 笔记经 `get_doc_content` 返回有界纯文本正文，Markdown 经受控 COS 下载返回有界 UTF-8 正文

#### Scenario: Honestly report unreadable PDF or subscribed-library items
- **WHEN** 检索或浏览命中了 PDF 文件（`media_type=1`）、微信公众号文章（`media_type=6`）或订阅知识库条目（`get_media_info` 返回 `code: 220030`）
- **THEN** `read` 诚实返回 `unsupported` 或 `content_unavailable` 并提示原格式或订阅库权限限制，绝不把标题或目录当作正文证据

### Requirement: Bounded and cancellable text downloads
文本下载 MUST 仅使用 `*.myqcloud.com` 或 `res-pkb.ima.qq.com` 上的 HTTPS URL，转发安全 `X-IMA-*` 头，剥离禁转头与 OpenAPI 凭据，拒绝 HTTP 重定向并支持取消。正文最多读取 5 MiB，超限时 MUST 停止下载。`media_type=5` 的条目仅在标题为 `.csv` 且响应为允许的文本 MIME 和有效 UTF-8 时按 CSV 读取。

#### Scenario: Reject a redirect or abort a partial download
- **WHEN** 下载响应尝试重定向、声明或累计正文超出 5 MiB，或下载期间收到取消信号
- **THEN** 应用终止下载，不提交正文。重定向目标不会收到请求或签名头

#### Scenario: Distinguish text CSV from binary Excel
- **WHEN** 目录包含同为 `media_type=5` 的 CSV 和 XLSX 文件
- **THEN** 应用只读取 `.csv` 且响应为 `text/csv` 或 `text/plain` 的有效 UTF-8 文本，XLSX 或非文本响应返回 `unsupported`

### Requirement: Read-only transport allowlist
`ima` transport SHALL 仅向 `https://ima.qq.com` 发送只读白名单路径（`search_knowledge_base`、`get_knowledge_base`、`get_knowledge_list`、`search_knowledge`、`get_media_info` 与 `/openapi/note/v1/get_doc_content`），MUST 拒绝任何写入路径（含 `get_addable_knowledge_base_list`、`check_repeated_names`、`create_media`、`add_knowledge`、`import_urls`、`import_doc`、`append_doc`）。全部请求 MUST 拒绝 HTTP 重定向。

#### Scenario: Transport refuses write endpoints
- **WHEN** 任何调用方（含知识工具或管理服务）尝试经 `ima` transport 请求写入路径
- **THEN** transport 在发出网络请求前直接拒绝，远端不收到任何写请求

### Requirement: Disconnect and credential revocation without remote side effects
用户断开 `ima` 连接、取消绑定某库或删除连接时，应用 MUST 仅变更本地状态并按退役策略清理本地凭据，MUST NOT 删除或修改远端 `ima` 知识库及文件。断开或撤销后，新请求 MUST 立即被拒绝，正在进行的活跃请求 MUST 可取消且不再发出后续请求。

#### Scenario: Disconnecting IMA keeps remote library intact and stops new requests
- **WHEN** 用户在「我的 → 知识库」断开或删除 `ima` 连接
- **THEN** 应用不向远端发起任何删除/写请求，本地绑定立即失效且后续浏览/检索/读取均被拒绝，历史消息仍可离线浏览与删除
