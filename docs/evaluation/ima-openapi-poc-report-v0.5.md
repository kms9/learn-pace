# ima OpenAPI 移动端直连实测报告（V0.5 / Change 14a 前置 PoC）

> 日期：2026-11-26  
> 环境：Node 22 + 真实 ima 个人账号凭据（经本地 `.env` 注入，本文零明文凭据、零完整 ID、零签名下载 URL）  
> 参考源：官方包 `ima-skills-1.1.10.zip`（`https://app-dl.ima.qq.com/skills/ima-skills-1.1.10.zip`）与仓库固定子模块 `upstream/deeptutor/deeptutor/services/rag/pipelines/ima/`  
> 为 Change 14a（`m2d-ima-knowledge-lf01`）验证只读 API 契约、权限矩阵和原文读取边界。受控上传可行性供 Change 14b 立项参考。

## 1. 官方包 `ima-skills-1.1.10.zip` 拆解结论

- **结构与依赖**：共 50 个条目（61 KB），含 macOS `__MACOSX/`、`.DS_Store`、`.history/`、`ima-skill/SKILL.md`、`ima_api.cjs`、`meta.json`、`notes/` 与 `knowledge-base/`（含 `preflight-check.cjs`、`cos-upload.cjs`、`note-images.cjs`）。
- **不可在移动端直接执行的原因**：
  1. `meta.json` 声明强依赖 `node >= 18.0.0` 执行 `.cjs` 脚本；
  2. `ima-skill/SKILL.md` 第 86 行包含 Claude Code Shell 插值语法（`` !`test -f ...` ``），按安全契约必须被包校验器拒绝；
  3. 包含写笔记、COS 上传等完整桌面脚本逻辑，不适合直接当作不可信 Skill 执行。
- **架构结论**：按 PRD 10（IMA-06）由应用内原生 TypeScript 实现 `ImaProvider`（直连 `https://ima.qq.com` 与受控 COS 域）并内置移动兼容只读 `ima-knowledge` Skill。同时针对普通 ZIP 导入，已在 `zip-reader.ts` 自动跳过 `__MACOSX/`、`._*`、`.DS_Store`、`Thumbs.db` 及非凭据隐藏目录（保留 `.env`/`.ssh`/`*.pem`/`*.key` 拦截）。

## 2. 真实 `https://ima.qq.com` OpenAPI 线上探测结果

请求头统一为 `Content-Type: application/json`、`ima-openapi-clientid`、`ima-openapi-apikey`（官方脚本另附可选 `ima-openapi-ctx: skill_version=...`）。

### 2.1 接口与字段实测差异（对照官方 `api.md`）

| 接口 | 实测耗时 | 实测返回结构与关键差异 |
|---|---|---|
| `POST /openapi/wiki/v1/search_knowledge_base` | ~750 ms | 发现账号下 28 个库（分页正常：第 1 页 20 条 `is_end=false`，第 2 页 8 条 `is_end=true`）。**线上实际返回 `kb_id`、`kb_name`**（而非文档写的 `id`、`name`），并附带 `base_type`（`个人知识库` / `共享知识库` / `我加入的订阅知识库`）、`role_type`（`创建者` / `普通成员`）、`content_count`、`member_count`、`description`。实现时需兼容 `kb_id ?? id` 与 `kb_name ?? name`。 |
| `POST /openapi/wiki/v1/get_knowledge_base` | ~620 ms | 按 `ids` 批量返回 `infos` 映射，条目键为 `id`、`name`、`cover_url`、`description`、`recommended_questions`。 |
| `POST /openapi/wiki/v1/get_addable_knowledge_base_list` | ~500 ms | 实测返回 `code: 0`，列出账号下 13 个可写入库，字段为 `id`、`name`，用于限定上传目标库。 |
| `POST /openapi/wiki/v1/get_knowledge_list` | ~650–690 ms | 返回 `knowledge_list`（含 `media_id`、`title`、`parent_folder_id`、`tags`、`media_type`）、`is_end`、`next_cursor`、`current_path`、`searched_tags`（含子文件夹时返回文件夹条目）。 |
| `POST /openapi/wiki/v1/search_knowledge` | ~920–1,150 ms | **重大实测发现**：10 组正文/标题查询中，仅标题/关键词命中，`info_list` 条目的 **`highlight_content` 长度全部为 `0`**，且 `data` 仅含 `info_list`（未返回 `is_end`/`next_cursor`）。这说明 OpenAPI 不提供服务端 RAG 摘要，可引用正文依赖 `get_media_info` 原文读取。 |
| `POST /openapi/wiki/v1/get_media_info` | ~340–900 ms | 按资源类型与库权限分叉（见下表）。 |
| `POST /openapi/note/v1/get_doc_content` | — | 官方 `notes/references/api.md` 确认参数为 `note_id`（来自 `notebook_ext_info.notebook_id`）与 `target_content_format: 0`（PLAINTEXT），仅作者本人笔记可读。 |

### 2.2 三类知识库权限与资源类型实测矩阵

| 库类型 | 浏览 / 搜索 | 实测代表类型 | `get_media_info` 实测结果 |
|---|---|---|---|
| **共享库（创建者）** | ✅ 可列 / 可搜 | PDF (`1`)、Word (`3`)、公众号 (`6`) | PDF 返回 `https://skb.ima.myqcloud.com/...` + 6 个 `X-IMA-*` 签名 Header，`GET`（`redirect: "manual"`）返回 **HTTP 200** `application/pdf`；公众号返回 `https://mp.weixin.qq.com/s/...`（302）。 |
| **共享库（普通成员）** | ✅ 可列 / 可搜 | PDF (`1`)、Word (`3`)、公众号 (`6`) | 普通成员同样可获取 COS 签名链接并返回 **HTTP 200**。 |
| **个人库（创建者）** | ✅ 可列 / 可搜 | 公众号 (`6`)、AI 会话 (`12`) | 公众号返回原微信链接；AI 会话返回 `code: 220030`（`该文件获取失败，请至ima内查看处理`）。 |
| **订阅知识库（普通成员）** | ✅ 可列 / 可搜 | 公众号 (`6`) 等 | **全部拒读**，返回 `code: 220030`：`没有权限通过skill获取订阅知识库的文件，请前往ima客户端尝试`。 |

### 2.3 实测错误码与安全传输边界

- **实测错误码**：除文档中的 `110001`–`110030` 及 DeepTutor 记载的 `20004`/`200002`（凭据拒绝）、`20002`/`110021`（限流）外，线上实测出现 `51`（proto 参数校验失败）、`220001`（参数错误）、`220030`（订阅库或不可读取媒体拒读）。
- **下载域与 Header**：COS 媒体下载域实测为 `skb.ima.myqcloud.com`（命中 `*.myqcloud.com` 与 `res-pkb.ima.qq.com` 白名单）；下载时必须转发 `url_info.headers` 中的安全业务头（如 `X-IMA-Create-URL-Time`、`X-IMA-Platform`、`X-IMA-Resource-Category`、`X-IMA-Sign`、`X-IMA-Trace-ID`、`X-IMA-UID-SHA256`），剥离 `cookie`/`host`/`connection`/`proxy-authorization` 等禁转头，严禁携带 `ima-openapi-apikey`，禁止跟随 HTTP 重定向。

## 3. Change 14b 受控上传同步可行性

- **可行性：高（零新增原生模块）**。
  - **本地文件上传**：`expo-document-picker` + `expo-file-system` → 纯 TS 预检（扩展名/MIME/大小，移动端首期单文件上限 20 MiB 防 Hermes 内存峰值）→ `check_repeated_names`（重名时提供保留副本追加时间戳或取消，不支持覆盖）→ `create_media` → **纯 TS 腾讯云 COS `PUT` 签名**（`cos-upload.cjs` 仅需 `HMAC-SHA1` + `SHA1`，直接复用已引入的 `@noble/hashes`，目标 Host 严格限定 `{bucket}.cos.{region}.myqcloud.com`，不携带 `ima-openapi-apikey`）→ `add_knowledge`。
  - **网页 / 公众号导入**：单步 `POST /openapi/wiki/v1/import_urls`（1–10 条，根目录传 `folder_id = knowledge_base_id`，拒绝 `file://` 与 Bilibili/YouTube 等不支持视频页）。
- 文件存储与管理由 `ima` 提供。Change 14a 范围为只读问答、受支持格式的原文读取与引用。
- Change 14b 拟提供从知识库管理入口显式触发的文件上传和 URL 导入。目标限可写库，禁止删除或覆写远端内容。待 PRD 补齐需求与验收编号后独立提案。

## 4. Task 0.1 真账号原文读取与搜索补测（2026-11-26）

在 ima macOS 客户端创建独立个人测试库，放入本人新建的笔记和 Markdown、CSV、XLSX 三个合成样本。笔记与 Markdown 分别包含只出现于正文的中文和英文测试词。使用同账号的 OpenAPI 凭据从 Node `v24.21.0` 直连，只记录接口状态、字段存在性和字节校验结果。现行 Change 14a 交付只读问答，§3 的受控上传评估供 Change 14b 使用。

### 4.1 目录、元数据和正文读取

`get_knowledge_list` 返回 HTTP 200 / `code: 0`，耗时 782 ms，列出全部 4 个样本。四行均有 `media_id`，文件标题均带扩展名。目录行均未携带 `notebook_ext_info.notebook_id` 或 `url_info.url`。逐项以原 `media_id` 请求 `get_media_info`，四项均返回 HTTP 200 / `code: 0`，`media_type` 与目录一致。详情未回传 `media_id`，来源标识应沿用目录或搜索结果中的 ID。

| 样本 | `media_type` | 详情字段 | 原文实测 |
|---|---:|---|---|
| 本人笔记 | `11` | 有 `notebook_ext_info.notebook_id`，也有 `url_info.url` | 以 `notebook_id` 调用 `get_doc_content`，`target_content_format: 0`。HTTP 200 / `code: 0`，348 ms，`data.content` 共 72 个字符，包含中英文两个正文词。 |
| Markdown | `7` | 有 `url_info.url` 和 `url_info.headers` | HTTPS GET 返回 200，`text/markdown; charset=utf-8`，405 ms，119 字节，与本地原文件逐字节一致。 |
| CSV | `5` | 有 `url_info.url` 和 `url_info.headers` | HTTPS GET 返回 200，`text/csv; charset=utf-8`，243 ms，33 字节，有效 UTF-8，与本地原文件逐字节一致。 |
| XLSX | `5` | 有 `url_info.url` 和 `url_info.headers` | HTTPS GET 返回 200，`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`，235 ms，1,500 字节，ZIP 文件头且无法严格解码为 UTF-8。应用应按二进制表格标为 `unsupported`。 |

三个文件实际下载域均为 `skb.ima.myqcloud.com`。探测仅转发 `url_info.headers` 中的六个 `X-IMA-*` 头，设置 `credentials: "omit"` 与 `redirect: "error"`。三个响应的 `redirected` 均为 `false`，请求未携带 OpenAPI 凭据。`media_type=5` 下可用目录标题的 `.csv` 扩展名、下载响应的文本 MIME 和严格 UTF-8 校验共同判定可读 CSV。耗时为本轮 Node 单次实测，Android 下载边界另由 Task 1.1 覆盖。本轮笔记权限证据限本人创建的笔记，TXT、HTML、JSON 未取样。

### 4.2 搜索对照与 Gate 14

两轮 `search_knowledge` 请求均返回 HTTP 200 / `code: 0`。笔记与 Markdown 的完整标题词都包含目标条目，也召回了其他同前缀样本。复测只用各自的标题后缀词时均精确命中一条。四个中英文正文独有词两轮均零命中，不存在的词也零命中。所有命中项的 `highlight_content` 均为空，响应未出现 `is_end` 或 `next_cursor`。

首期以标题词或目录定位文档，再通过 `knowledge_read` 取实际正文作为引用依据。Gate 14 ② 的提问提供可检索的标题线索，独有事实只放在正文。这样可以分别核验文档定位、正文读取、事实回答和引用。

## 5. Task 1.1 Android 下载与流式边界（2026-11-26）

在 Redmi K20 Pro 尊享版上运行隔离探测包，环境为 Android 11、ARM64、Hermes、Expo `58.0.22`。包内调用 `expo/fetch` 访问 Task 0.1 的 COS Markdown 样本。302、307、超限和慢响应由两组 USB 转发的回环端点提供，服务端独立记录请求次数和连接关闭。真机仅收到合成样本的临时下载信息，OpenAPI 凭据留在本机。

| 场景 | 实测结果 |
|---|---|
| 真实 COS HTTPS | `skb.ima.myqcloud.com` 返回 HTTP 200，`text/markdown; charset=utf-8`。转发六个签名头，119 字节正文与样本一致。 |
| 拒绝重定向 | `redirect: "error"` 下 302 和 307 均拒绝。初始端点各收到一次携带测试头的请求，目标端点均收到零请求。允许跟随的对照抵达目标一次，但最终 200 响应的 `redirected` 为 `false`。 |
| 无 `Content-Length` 的正常流 | 65,537 字节和恰好 5,242,880 字节均完整读出。 |
| 无 `Content-Length` 的超限流 | 累计收到 5,251,065 字节时识别越界。保留的正文缓冲停在 5,242,880 字节，丢弃越界块并主动中止。服务端在发完 6 MiB 前观察到连接关闭。 |
| 声明长度超限 | `Content-Length` 为 6,291,456 字节时，应用在读取正文前中止，正文缓冲为零。服务端观察到连接关闭。 |
| `AbortSignal` 取消 | 响应头返回前取消时，等待响应的 Promise 拒绝。读到首块后取消时，等待下一块的 Promise 拒绝。两个端点均在发完预定内容前观察到连接关闭。 |

实现应始终设置 `redirect: "error"`，并检查 `response.redirected` 作为补充。读取前校验声明长度，流式读取按字节累计并在追加越界块前拒绝。超限时显式中止传给 `expo/fetch` 的信号，让底层请求随之取消。
