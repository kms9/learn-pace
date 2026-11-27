# knowledge-qa-runtime Specification

## ADDED Requirements

### Requirement: Turn-scoped knowledge base selection and built-in compatible Skill
问答（LF01）与 Dito 小老师输入框 SHALL 提供独立于「技能」的「知识库」选择 chip（单轮至多选 1 个已绑定且连接就绪的库，不选库不发起 `ima` 请求），并支持切换「仅知识库回答」与「普通问答」。小老师默认继承父会话锚点回合的已绑定库并在预解析时复查授权，不扩大范围。应用 SHALL 提供内置移动兼容只读 `ima-knowledge` Skill 并复用既有安装/启用/收据机制；选库 MUST NOT 自动安装或启用 Skill，未启用该 Skill 时仍可按 Host 基础规范完成知识库问答且不伪造 Skill 收据。

#### Scenario: Ask a question with a bound knowledge base and optional teaching skill
- **WHEN** 用户在问答输入框选定一个已绑定知识库（可同时搭配已启用的教学 Skill 或内置 `ima-knowledge` Skill）并发送问题
- **THEN** Host 在写入消息前校验连接与绑定有效性，固定本轮 `bindingId`，注册只读知识工具并执行检索与必要正文读取，不向未选中的其他库发送任何请求

#### Scenario: Reject turn before writing when selected binding is revoked or disconnected
- **WHEN** 用户发送或重试一条携带已断开连接或已解绑知识库的回合，或显式选中依赖 `knowledge_*` 工具的 Skill 却未选定任何知识库
- **THEN** Host 在写入消息前抛出类型化 `ExtensionPrepareError`（`kb_not_configured`、`kb_auth_denied`、`kb_binding_missing` 或 `dependency_missing`），不写半轮、不静默换库且不发模型请求

### Requirement: Turn-scoped source handles and shared reading budget
Host SHALL 为每轮知识库问答维护独立 `SourceLedger`，为 `knowledge_search` 与 `knowledge_list` 返回的文档签发不透明 handle。`knowledge_read` MUST 仅接受本轮登记的 handle，拒绝任意 `mediaId`、URL、文件夹或跨库 ID。每轮共享读取预算为最多 4 个文档，单文档最多 12,000 字符，总外部正文最多 24,000 字符。

#### Scenario: Concurrent reads remain within the selected library and shared budget
- **WHEN** 模型尝试并发读取文档，包括伪造、跨库或超预算请求
- **THEN** Host 只执行通过 handle 校验且符合共享预算的读取，拒绝其余请求

### Requirement: Verified SourceLedger citations and offline snapshots
仅含真实可读正文或非空高亮且有稳定 ID 的条目 SHALL 获得可引用的 `sourceId`。Host SHALL 记录库和文档 ID、标题、来源类型、检索时间与内容 hash。经核验的引用 SHALL 显示来源卡并保存有界离线快照。

#### Scenario: Grounded answer cites verified readable sources with offline snapshot
- **WHEN** 已授权测试库包含模型无法预知的独有事实（笔记或 Markdown），用户选库提问并启用「仅知识库回答」
- **THEN** 模型通过 `knowledge_search` 或 `knowledge_list` 发现文档并经 `knowledge_read` 获取真实正文、在回答中引用 `[S1]`；Host 在终态落盘前核验 `sourceId` 并渲染来源卡与有界离线快照，离线重启后仍可查看当时引用片段

### Requirement: KB-only answers discard text generated before evidence
`kb_only` 回合在模型获得本轮首个可读 `sourceId` 前 MUST 丢弃模型正文增量，界面仅显示检索、阅读等进度。丢弃的正文 MUST NOT 出现在后续流式输出、checkpoint 或终态。全轮缺少可读证据时，Host SHALL 显示资料不可读的原因。

#### Scenario: KB-only mode refuses to fabricate answers when sources are unreadable
- **WHEN** 用户在「仅知识库回答」模式下提问，而检索无匹配或命中文件均为暂不可读的 PDF/订阅库拒读条目
- **THEN** Host 在终态核验时阻止无依据模型回答冒充知识库结论，明确告知未找到可读正文及原因（提示可显式切回普通问答），绝不把仅标题条目渲染为已验证引用

#### Scenario: KB-only mode discards early text even if a later read succeeds
- **WHEN** 模型先输出无依据的正文，随后取得首个可读来源并继续生成
- **THEN** 界面只在取得来源后显示新生成的正文，且后续 checkpoint 和终态仅保留取得来源后生成的正文

### Requirement: Knowledge tool receipt finalization
中断或强杀时，Host MUST 将未落定的 `knowledge_receipts` 更新为 `interrupted` 或 `unknown`。

#### Scenario: Reconcile pending receipts after cancellation or recovery
- **WHEN** 工具调用已记录为 `started`，但回合在结果落盘前取消或应用被强杀
- **THEN** 取消落盘时更新为 `interrupted`，重启恢复时更新为 `unknown`

### Requirement: Revocation and post-restore provenance isolation
凡引用或读取过外部知识库的回复，Host SHALL 持久化 `knowledge_provenance` 元数据。当对应 `bindingId` 被撤销、连接已断开或备份恢复后尚未重新授权时，Host MUST 在所有自动上下文装配路径（`boundedHistory`、`promptWithQuotes` 引用芯片、`parentTranscript`、小老师 `selected_text` 与 `ChatQuickChecks` 自测出题的历史与 `focusExcerpt`）中过滤受影响的外部来源文本并以脱敏占位替代，禁止自动二次外发给模型；以已撤权外部来源回复为焦点发起自测时 MUST 拒绝并提示重新连接；本地界面仍可离线浏览与删除。用户主动将带外部来源的回复「收藏为知识卡」或「转为学习目标」时，应用 SHALL 弹出数据流向提示并由用户明确确认。

#### Scenario: Revoked knowledge base replies are excluded from automatic model context
- **WHEN** 用户断开或解绑某知识库后，在原问答会话继续普通提问（含此前引用该回复的引用芯片）、发起「考考我」自测或打开关联小老师追问
- **THEN** 此前来自该库的回答在本地历史中仍可阅读，但在发送给模型的 `boundedHistory`、`quotes`、`parentTranscript`、小老师选文与自测出题上下文中均被脱敏占位替代，不再自动外发
- **AND** 直接从该库来源的回复发起「考考我」时，应用拒绝出题并提示先重新连接或从其他回复发起

#### Scenario: Saving an external-source reply as a knowledge card requires explicit notice
- **WHEN** 用户对一条带有外部知识库来源的助手回复点击「收藏为知识卡」或「转为学习目标」
- **THEN** 应用弹出数据流向说明，经用户明确确认后才将其复制为本地知识卡或学习目标摘录
