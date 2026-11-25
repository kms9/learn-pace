# Proposal

## Why

产品目标是「打开应用即是 DeepTutor 的手机版」（D8）。DeepTutor 的精通之路由导师在会话中调用工具推进：新建目标只创建一条空路径，随即进入「编辑大纲」模式的会话，导师了解学习者后用工具建出并修订大纲，学习者同意后切到学习模式。原 Change 3 的「表单 → 一次性生成 → 确认按钮」与此不同，因此重写为本 Change：交付精通之路列表、新建向导、路径页基础版，以及后续学习与复习共用的精通会话骨架和编辑大纲模式（AC-03）。

## What Changes

- **领域（`packages/domain`）**：
  - `LearningProgress` 增加可选 `goal`、`emoji`、`topic_sources`；
  - 移植 DeepTutor 的先修关系校验（`objective_relations.py`）、大纲语义身份（按「名称 + 类型」保持知识点 ID）与模块修订规划（`outline_revision.py`）；
  - 路径状态推导（无大纲 / 学习中 / 已完成）。
- **精通会话（`packages/app-host`）**：
  - 新增 `MasterySessionService`：一条路径多个会话，会话模式可切换（编辑大纲 / 学习 / 复习），每轮注入状态快照与移植的中文导师提示词，同一路径同时只允许一个运行中的回合；
  - 消息状态规则复用 Change 2（从 `Lf01ChatService` 抽出共用的回合引擎）；
  - 精通工具首批：`mastery_status`、`mastery_profile`、`mastery_mode`、`read_source`、`mastery_build`、`mastery_revise`（直接修改或预览后提交，校验基线版本，预览 1 小时过期）；
  - 工具一律挂载，执行时按会话模式校验。
- **界面（`apps/mobile`）**：
  - 「精通之路」Tab：路径卡片、到期复习横幅（有到期项时）、「新建精通目标」；
  - 新建向导 `mastery/new`：目标 + 图标 → 资料（问答会话、选文、文本笔记，可不选）+ 模型，「和导师一起定大纲」；提交即进入编辑大纲会话并自动发送开场消息；
  - 路径页基础版 `mastery/[pathId]`：标题与改名、目标、资料、进度、「下一个」、只读大纲、学习会话列表、重置进度与删除主题；
  - 精通会话 `mastery/[pathId]/session/[sessionId]`：模式切换、模式说明、空会话标题与三个起手提示、消息流、输入框、大纲弹层（随工具调用刷新）、「大纲已就绪——共 N 个知识点」与「开始学习」。
- **出处声明**：仓库根目录新增 `NOTICE`，注明移植自 DeepTutor（Apache-2.0）的提示词与算法。

### Out of Scope（本 Change 明确不做）
- 学习与复习模式的出题、批改、定性评估、讲解记录、延期、报错、跳过、升级庆祝、证据抽屉与自报掌握（Change 4′ `m2a-mastery-study-session`）。本 Change 中学习模式可以对话，但没有题卡。
- 复习范围限制、复习计划面板与复习入口（Change 5′ `m2a-mastery-review`）。
- 学习首页与聊天中的交接卡（Change 6′ `m2a-learning-home-and-shell`）。
- 路径页的看板视图与手工「编辑模块」、知识库/PDF/RAG 资料、`ask_user` 澄清卡、多模型选择（P0 只有 DeepSeek Flash，向导中只读展示）。
- 大纲提交的原子事务与 CAS（D3，M2-B Change 7）；本 Change 只做基线版本比对。

## Capabilities

### New Capabilities
- `mastery-topics`: 精通之路列表、新建向导（含从问答带入资料）、路径页基础版、改名、重置进度、删除主题。
- `mastery-session`: 精通会话（每路径多个会话、三种模式与切换准入、按模式校验工具、每轮状态快照、导师提示词、单路径单回合、消息恢复、开场消息与起手提示）。
- `mastery-outline`: 编辑大纲模式（学习档案、`mastery_build` 语义身份、`mastery_revise` 直接修改与预览提交、先修关系校验、大纲弹层、大纲已就绪提示）。

### Modified Capabilities
<!-- 无；问答与导航相关修改已在 Change 2 提交 -->

## Dependencies

- Change 2 已归档（runtime `instructions` / `history`、消息状态规则、`MessageContent`、`mastery/*` 路由占位、主题与文案）。
- 技术验证 S7 通过（DeepSeek Flash 在真机稳定驱动多工具循环）；若 S7 结论要求调整工具形态或提示词，先修订本 Change 再实施。

## Impact

- **`packages/domain`**：`models.ts`（新增字段与 `TopicSource`）、新增 `objective-relations.ts`、`outline-identity.ts`、`outline-revision.ts`，`policy.ts` 新增 `derivePathStatus`，及对应测试。
- **`packages/app-host`**：新增 `chat-turns.ts`（自 `lf01-chat.ts` 抽出的回合引擎）、`mastery/session-service.ts`、`mastery/tools/*.ts`、`mastery/status.ts`、`mastery/prompts.ts`，及测试。
- **`packages/infra`**：SQLite v4 重建 `interactions` 表以支持 `abandoned` 状态；`InteractionStore` 增加放弃与按路径删除，`SessionStore` 增加按路径列出、更新与删除会话，`learning_progress` 增加删除。
- **`apps/mobile`**：`app/(tabs)/paths.tsx`、`app/mastery/new.tsx`、`app/mastery/[pathId]/index.tsx`、新增 `app/mastery/[pathId]/session/[sessionId].tsx`。
- **仓库根**：`NOTICE`。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm test` 全绿；Android 真机完成新 AC-03。
