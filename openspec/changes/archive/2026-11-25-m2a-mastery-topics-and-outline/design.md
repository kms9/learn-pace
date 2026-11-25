# Design

## Context

参见 `proposal.md`、`docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md` §3.5–3.7、§4 与 `docs/prd/04-lf02-mastery-flow.md`。Change 2 提供 runtime `instructions` / `history`、问答消息状态规则、`MessageContent`、`mastery/*` 占位路由与 DeepTutor 主题。

DeepTutor 参照（`upstream/deeptutor`）：
- 会话与模式：`deeptutor/capabilities/mastery/mode.py`（`TOOL_MODES`、`tool_is_allowed`、`admission_error`：只有「无大纲不能进学习模式」一条拒绝，复习不以到期为前提）、`capability.py`、`binding.py`、`loop.py`（每轮先注入 `mastery_status`）、`pipeline.py`。
- 提示词：`deeptutor/capabilities/mastery/prompts/zh/mastery_loop.yaml`（`general`、`runtime_policy`、`loop.system`、`session.outline|study|review`、`playbook`）。
- 大纲：`tools.py` 的 `mastery_build`（第 2453 行起）与 `mastery_revise`（第 2913 行起），`deeptutor/learning/service.py` 第 240–306 行（语义身份）与第 1945–2038 行（预览与提交），`outline_revision.py`（模块重排与状态摘要），`objective_relations.py`。
- 界面：`web/components/space/learning/TopicAtlas.tsx`、`CreateTopicWizard.tsx`、`TopicWizardSteps.tsx`、`web/app/(workspace)/learning/mastery/[pathId]/page.tsx`、`MasteryStudy.tsx`、`ModeSwitch.tsx`、`web/lib/mastery-mode.ts`、`next-step-copy.ts`；文案 `web/locales/zh/app.json`。

## Goals / Non-Goals

**Goals:**
- 精通会话骨架可被学习、复习模式直接复用：会话、模式、工具校验、状态快照、提示词、回合锁、消息恢复。
- 新建目标与编辑大纲模式的交互、工具语义与文案和 DeepTutor 一致。

**Non-Goals:**
- 题卡、评分、证据、复习（Change 4′、5′）。
- 手工编辑模块、看板视图、`ask_user` 澄清卡、知识库与 PDF 资料。
- 事务与 CAS（D3）。

## Decisions

### 1. 领域模型与路径状态
- `LearningProgress` 增加可选 `goal?: string`、`emoji?: string`（默认 `🧭`）、`topic_sources?: TopicSource[]`。`TopicSource = { id, kind: "goal" | "chat" | "text_note", label, excerpt, source_session_id?, source_message_id?, created_at }`。创建时总有一条 `kind = "goal"` 的来源（同 DeepTutor 向导把目标作为第一条资料）。旧数据缺字段时按空值读取，无需迁移。
- `derivePathStatus(progress)`：没有知识点为 `draft`（界面称「无大纲」），全部知识点 `isMastered` 为 `completed`，否则 `active`。不再使用 `archived`。每次写入路径都用它更新 `learning_progress.status`。
- 重置进度：清空作答、证据、掌握、定性标记、自报掌握、延期、复习状态与队列、讲解记录、费曼记录、错因，放弃该路径未结束的题卡，保留大纲、来源、目标与学习档案（同 DeepTutor `service.reset_path`）。删除主题：删除路径进度、其全部精通会话与消息、题卡。两者都需二次确认。
- 存储：SQLite v4 迁移重建 `interactions` 表，把状态约束扩展为 `awaiting_input` / `answered` / `graded` / `abandoned`（无损复制既有记录）；`InteractionStore` 增加 `abandonInteraction(id, now)` 与按路径删除；`SessionStore` 增加按路径列出、更新与删除会话。

### 2. 精通会话与模式
- 会话：`sessions(kind = "mastery", path_id, mode)`；一条路径可有多个会话，`mode` 可更新。新会话的初始模式由入口决定（新建目标为 `outline`，路径页「学习会话 +」为 `study`，复习入口为 `review`）。
- 切换：会话顶部三段切换「编辑大纲 / 学习 / 复习」（`masteryMode.*` 文案）；导师可调用 `mastery_mode`。生成中不可切换。准入只有一条：大纲为空时不能进入学习模式，拒绝文案与 DeepTutor `admission_error` 一致。复习不要求有到期项（复习范围限制在 Change 5′ 的出题工具上）。
- 模式说明行：编辑大纲「还没有开始教任何东西——这个模式是用来商定你要学什么的。」，复习「这个模式只重测你已经学过的内容，不会教新知识点。」，学习无说明行。
- 空会话：编辑大纲标题「定下你的大纲」，复习标题「回头过一遍学过的」，学习以当前目标为标题；各有三个起手提示，取 DeepTutor `STARTERS` 的中文：
  - 编辑大纲：「按我挑的资料给我一版大纲」「先问我几个问题，再提大纲」「我想先聊聊要学到什么程度」
  - 学习：「先出一道题，看看我已经会了什么」「从直觉和一个具体例子讲起」「直接来一道有挑战的题」
  - 复习：「复习今天到期的内容」「回头看我最吃力的部分」「把我掌握过的都考一遍」
  点起手提示即发送。
- 开场消息：从向导进入时自动以学习者身份发送「用我选的资料，和我一起制定这个精通目标的大纲。」（`masteryOpeningMessage("outline")`）。手动切换模式不发送开场消息。

### 3. 回合引擎、状态快照与提示词
- 从 `Lf01ChatService` 抽出 `chat-turns.ts` 回合引擎（消息落库、`generating` → 终态、冷启动恢复、重试、有界历史），问答、小老师与精通会话共用。
- 同一路径同时只允许一个运行中的回合（内存锁，对应 DeepTutor 路径租约）；另一会话正在运行时，发送按钮显示等待并说明原因。
- 每轮 `instructions` = 移植的提示词（`general` + `runtime_policy` + `loop.system` + 当前模式的 `session.*` + `playbook` 中与本期工具相关的段落）+ 本轮 `mastery_status` 快照（JSON，标注为数据）。提示词删除知识库、PDF、视觉题、`mastery_switch` / `mastery_paths` 与笔记本相关句子；中文原文保留，文件头注明出处与 Apache-2.0；并按 S7 实测校准补入「调用 `mastery_quiz` 前先输出简短可见引导语，再调用工具」的明确约束（避免模型偶发省略引导语直接出题）。
- 精通会话默认沿用 S7 验证通过的运行参数：`maxTurns = 8`（S7 50 轮实测往返 P95 = 3、最大 = 4）与 `reasoning = "high"`（S7 实测 TTFT P50 2.251 s / P90 5.100 s，且避免了 `off` 样本的超时波动）。
- `mastery_status` 快照字段：`path_id`、`path_name`、`goal`、`status`（`empty` / `active`）、`mode`、`sources`（标签与摘要）、`next`（`nextObjective` 的结果；存在未结束题卡时由 Host 以 `answer_pending` 覆盖）、`map`（`mapSummary`）、`learning_stages`、`learner_profile` 与 `intake_needed`、`pending_interaction`（Change 4′ 起填充）、`path_revision`（`progress.version`）。
- `history`：本会话已完成消息，上限同问答（12 条、12,000 码点）。

### 4. 工具框架、Runtime 适配与首批工具
- `packages/runtime`（`PiDurableRuntime`）的两项通用能力已在 S7 验证阶段落地并保留 M1 `register_question` 与既有 27 个 runtime 测试不变，本 Change 直接复用并校验对齐：
  1. **通用工具终止回合**：`RuntimeTool` 支持触发 `finishQuestionRound` 立即收尾（`stopReason: "tool_terminated"`），供 Change 4′ 的 `mastery_quiz` 在出题落库后立即结束本轮；且**不启用** M1 `register_question` 的 `bufferedText` 全轮禁流与清空前置文本逻辑，保证导师在所有模式（含出题前的引导语）都能实时流式输出（答案仅放在工具私有参数中，靠提示词约束正文不剧透，已通过 S7 16/16 零剧透验证）；
  2. **可配 `maxTurns`**：`RuntimeTurnRequest` 已支持可选 `maxTurns`，按 S7 校准结果默认保持 `8`（搭配 `reasoning: "high"`）。
- `packages/app-host/src/mastery/tools/` 为每个工具定义 `name`、参数 schema、允许的模式与执行函数。Host 在会话运行时把全部精通工具注册到该会话的 `PiDurableRuntime`，`allowedTools` 为全部精通工具名；执行时必须读取 Host 维护的**会话当前实时模式**（而非 `RuntimeTurnRequest.mode` 的回合初始快照，确保同回合内调用 `mastery_mode` 后立即生效），不允许则返回拒绝原因（不抛错），与 DeepTutor `mode.py`「一律挂载、执行时校验」一致。路径与会话 ID 来自 Host 绑定，不接受模型传入。
- 首批工具：
  - `mastery_status`（全部模式）：返回最新快照；模式或大纲变化后导师可重新获取。
  - `mastery_profile`（全部模式）：合并写入 `learner_profile`（`prior_knowledge`、`target_level`、`time_budget`、`preferences`、`teaching_strategy`：`probe_first` / `teach_first`、`notes`）。
  - `mastery_mode`（全部模式）：切换模式，按决策 2 校验，返回新模式的 `session.*` 指令。
  - `read_source`（全部模式）：按来源 ID 读取本路径的文本资料，单次最多 8,000 码点，支持分段读取。
  - `mastery_build`（编辑大纲）：`mode = replace | append`、`path_name`、`modules[]`（模块名、目标、知识点：名称、类型、先修名称或 ID、来源 ID）。`replace` 按决策 5 的语义身份映射 ID；`append` 新增模块。路径尚无名称时采用 `path_name`。
  - `mastery_revise`（编辑大纲）：见决策 6。

### 5. 大纲语义身份与先修校验
- 移植 DeepTutor `_replace_module_set` 的语义身份：新大纲中「名称（去首尾空白、忽略大小写）+ 类型」与旧大纲唯一匹配的知识点沿用旧 ID 及其进度；其余知识点新建 ID；旧大纲中未被匹配的知识点的进度、定性标记、自报掌握、延期、复习状态被移除，作答与证据保留但不再关联可见知识点（同上游）。
- 写入前执行先修关系校验（移植 `objective_relations.py`）：ID 唯一、无自依赖、无未知先修、无环、来源引用有效且不指向 `goal` 来源。校验失败把原因作为工具结果返回给导师，不写入。

### 6. 大纲修订：直接修改与预览提交
- `mastery_revise` 参数：`action`（省略 = 直接修改，`preview`，`commit`）、`module_id` 或 `modules[]`（每项含 `rewrite` / `add` / `remove`），`module_order`（仅预览时，必须列出全部现有模块 ID 各一次），`preview_id`（仅提交时）。
- 直接修改：按语义身份规则立即写入，`version` 加 1。`rewrite` 产生新 ID 的知识点进度重置（同上游 `_plan_module_revision`）。
- 预览：校验 `expected_revision = progress.version`，生成预览记录 `{ preview_id, session_id, base_revision, before_digest, proposed_modules, changes, effects, expires_at = now + 1h }`，保存在 Host 内存中，返回差异、受影响的进度与拟议大纲。`before_digest` 为不含 `version` / `updated_at` 的进度摘要（同 `outline_revision.state_digest`）。
- 提交：只接受 `preview_id`；预览必须属于本会话、未过期、`base_revision` 与 `before_digest` 都与当前一致，否则拒绝并要求重新预览。应用重启后预览失效（内存保存），导师重新预览即可。
- 模块重排只能经预览提交，保持知识点 ID 与进度。

### 7. 界面
- 「精通之路」Tab（`app/(tabs)/paths.tsx`）：标题「精通之路」；路径卡片（图标、名称、已掌握/总数进度条；无大纲时显示「去定大纲」）按最近更新排序；有到期复习的路径时顶部显示横幅（文案与入口在 Change 5′ 接入，本 Change 只在 `dueReviews` 非空时显示数量）；「新建精通目标」。空态说明并引导新建。
- 新建向导（`app/mastery/new.tsx`，两步）：
  - 第一步：目标（必填，最多 2,000 字）、图标（默认 🧭，从一组预设中选）；目标为空不能下一步。
  - 第二步：资料——从问答会话中选（会话标题、可展开选择某条消息）、从 Change 2 带入的选文（预选）、手动添加文本笔记；可不选。模型为当前 DeepSeek Flash 配置的只读展示，未配置时提示去「我的」配置且可先创建。按钮「和导师一起定大纲」。
  - 提交：创建路径（`status = draft`）与编辑大纲会话，跳转会话页并发送开场消息；未配置模型时只创建并停在会话页，提示配置后发送。
- 路径页基础版（`app/mastery/[pathId]/index.tsx`，单列）：图标与标题（可改名）、目标、资料标签（最多 5 个）、「已掌握 x / 共 y」进度条；「下一个」区按 `next.action` 显示 DeepTutor `NEXT_LABELS` 文案与主按钮（无大纲时「和导师一起定大纲」）；只读大纲（模块与知识点、类型、状态）；「学习会话」列表（模式、最近一条消息、更新时间，可打开；「+」新建学习会话）；「更多」中「重置进度」「删除主题」。
- 精通会话（`app/mastery/[pathId]/session/[sessionId].tsx`，`sessionId = new` 时带 `mode` 参数新建）：顶部返回、模式切换、进度环（已掌握/总数）、大纲按钮（底部弹层，工具返回后刷新，高亮当前目标）；模式说明行；空会话标题、说明与起手提示；消息流（`MessageContent`）；编辑大纲模式且大纲非空时显示「大纲已就绪——共 N 个知识点」与「开始学习」（新建一个学习模式会话，同 DeepTutor）；输入框与停止生成。

## Risks / Trade-offs

- **[Risk] 导师循环依赖 DeepSeek Flash 稳定调用多工具** → Mitigation：S7 已验证通过（`GO`：工具合法率 98.1%、出题即收尾且零剧透 16/16、Node 10/10 + Android 真机 `86ceabbf` 2/2）；单测仍用脚本化模拟网关覆盖工具调用序列与拒绝路径。
- **[Risk] 提示词与快照每轮较长，增加成本与首字延迟** → Mitigation：只注入当前模式的 `session.*` 与相关 `playbook` 段落，快照只含必要字段；真机记录 token 与延迟。
- **[Risk] 语义身份在知识点改名时会生成新 ID 并清除其进度** → Mitigation：与上游一致；`mastery_revise` 预览返回受影响的进度，提示词要求导师向学习者说明。
- **[Risk] 预览保存在内存，应用重启后失效** → Mitigation：提交时给出明确拒绝原因，导师重新预览；不影响已提交的大纲。
