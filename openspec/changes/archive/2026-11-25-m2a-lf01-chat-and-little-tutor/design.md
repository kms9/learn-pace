# Design

## Context

参见 `proposal.md`、`openspec/ROADMAP.md` 与 `docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md` §3.1–3.3。Change 1 已在 `packages/infra` 建好 `sessions`、`messages`、`session_threads` 表与 `AppStore` 双轨实现，`AppBootstrapService` 负责读取 DeepSeek Flash 配置；`packages/runtime` 的 `PiDurableRuntime` 已在 Android 真机验证。

DeepTutor 参照（`upstream/deeptutor`）：
- 聊天：`web/features/chat/components/ChatWorkspace.tsx`、`web/features/chat/messages/ChatMessageList.tsx`（重新生成、重试、删除整轮、停止）；会话菜单 `ChatLocation.tsx`（列表排除侧聊与学习会话）。
- 选文与侧聊：`ChatWorkspace.tsx` 第 1794–1897 行（选文工具条「添加到对话框」「问 Dito」）、`web/lib/side-chat.ts`（侧聊不写回父会话、选文预填不自动发送）、`deeptutor/services/session/_turn_runtime_shared.py` 第 1141–1256 行（父会话上下文：每条 6,000、合计 24,000 字符，取最新部分）、`MessageThreadMarker.tsx`（「小老师 ×N」、打开、删除、解除关联）。
- 文案：`web/locales/zh/app.json`；主题：`web/app/globals.css`。

## Goals / Non-Goals

**Goals:**
- 问答与小老师的交互、上下文规则和文案与 DeepTutor 一致，适配手机单栏布局。
- 应用壳切换为 DeepTutor 的 Tab 命名、默认页、主题与文案，移除 P00。
- 以 `learn-pace.db` 为唯一权威，强杀后可恢复。

**Non-Goals:**
- 不在 `packages/runtime` 引入独立的 Agent 存储；多轮上下文每轮从 `messages` 表装配。
- 不实现新建向导、精通会话、交接卡（Change 3′、6′）。
- 不做事务控制或 `submission_id` 幂等锁（D3）。

## Decisions

### 1. 多轮上下文：`instructions` 与有界 `history`
- `RuntimeTurnRequest` 增加可选 `instructions?: string`（透传为 Pi Durable root 的 `agent.instructions`）与 `history?: readonly { role: "user" | "assistant"; content: string }[]`（经 `GenerationTask.beforeRequest` 按原顺序放在当前输入之前）。未提供时沿用 M1 行为，既有 27 个 runtime 用例不受影响。
- 主会话：Host 取本会话已完成的消息，最多最近 12 条、合计 12,000 个 Unicode 码点，超限时从最早的完整一问一答开始丢弃；生成中、中断、失败的回复不纳入。当前提问单独提交。
- 助手消息 `metadata.model_id` 记录该轮实际请求的模型 ID（含中断与失败）；模型配置在每轮开始时解析，历史读取可离线。
- M1 遗留的 `register_question` 回合（仅用于开发版 M1 工作台兼容）若同时有 Host 指令，最终指令为「Host 指令 + 空行 + 出题指令」；Change 3′/4′ 的精通会话改由一般精通工具（`mastery_quiz` 等）与每轮 `instructions` 驱动。

### 2. 存储
- 主会话：`sessions(kind = "lf01", path_id = null, mode = null)`。会话列表只返回 `kind = "lf01"`，按 `updated_at` 降序；侧聊与精通会话不出现在列表中（同 DeepTutor `ChatLocation`）。
- 小老师：先写 `sessions(kind = "little_tutor")`，再写 `session_threads`，`thread_id = session_id`。
- SQLite v3 迁移为 `session_threads` 增加可空列 `selection_start`、`selection_end`（UTF-16 半开区间，基于消息原文）与 `detached_at`（解除关联时间）。逐列检测补齐，成功后更新 `user_version`；旧线程三列为空。
- `messages.metadata` 可包含 `model_id`、`source_user_message_id`、`quotes`（见决策 4）。
- `MessageStore` 增加 `deleteMessages(ids)`；`ThreadStore` 增加 `deleteThread(id)`（同时删除该侧聊会话与消息）与 `updateThread(thread)`。

### 3. 选文交互（手机端）
- React Native 在 Android 上自定义系统选区菜单不可靠，因此采用「长按消息 → 选文确认层」：默认整条消息，可裁切；原文中有相同片段时由用户确认是哪一处。确认层提供「添加到对话框」「问 Dito」（DeepTutor 原文）与 Learn Pace 保留的「转为学习目标」。
- 选区以消息原文计算，校验 `content.slice(start, end) === selected_text`，边界不能切开 Unicode 码点。只锚定一条已完成的消息（DeepTutor 支持跨消息选区，手机端不做）。

### 4. 添加到对话框（替代 V0.2 的「引用摘要回主会话」）
- 选文进入当前会话输入框上方的引用条，最多 3 条，可单独移除；不自动发送。
- 发送时用户消息的 `content` 只保存用户输入，`metadata.quotes = [{ text, source_message_id }]`；界面以引用条显示。请求中把引用以「引用 1：……」的形式放在用户输入之前，单条最多 2,000 个 Unicode 码点。
- 在小老师侧聊中对侧聊消息选文时，「添加到对话框」加入侧聊自己的输入框；侧聊内容不会自动出现在父会话中。

### 5. 小老师侧聊
- 「问 Dito」创建侧聊并打开侧聊页面，选文预填到侧聊输入框，不自动发送。
- 每轮请求：
  - `instructions`：说明这是对父会话的局部追问，附上「父会话记录」作为数据（非指令）——取父会话截至当前最新一条已完成消息的记录，从最新往前取，每条最多 6,000、合计最多 24,000 个 Unicode 码点，按原顺序排列；
  - `history`：侧聊自身已完成的消息，上限同主会话；
  - 当前输入单独提交。
- 侧聊不写回父会话，父会话的消息、草稿和滚动位置保持不变。
- 锚点消息下显示「小老师 ×N」（只统计未解除关联的侧聊），点开列出侧聊，可打开、删除（需确认）、解除关联。解除关联后侧聊仍可从该会话菜单的「小老师记录」打开。

### 6. 流式、中断、重试、重新生成与删除
- 应用内同一个 `Lf01ChatService` 实例由 `AppContext` 持有，在内存中保证同一会话同时最多一个运行回合。
- 发送：先落库用户消息（`committed`），再落库助手行（`generating`，带 `turn_id`、`metadata.source_user_message_id`、模型 ID），然后请求。首个片段落库，之后最多每秒保存一次；终态写入最终文本与状态：正常 `committed`、手动停止 `interrupted`、网关或网络异常 `failed`（错误经脱敏）。
- 冷启动遗留的 `generating` 标为 `interrupted`；只有用户消息、缺少助手行时补写中断占位。恢复只访问本地存储，不自动重发。
- 重试（中断或失败）与重新生成（最后一条已完成回复）：用同一条用户消息及其之前的有界历史，分配新 `turn_id`，原位更新该助手行，其后消息保持不变。
- 删除整轮：确认后删除该用户消息与对应助手回复；锚定在被删消息上的侧聊改为解除关联（同 DeepTutor `ChatWorkspace.tsx` 第 1007–1023 行）。

### 7. 转为学习目标
- 「转为学习目标」导航到 `mastery/new`，参数 `sourceSessionId`、`sourceMessageId`、`sourceExcerpt`（已确认选文或整条消息，最多 600 个 Unicode 码点）。目标由学习者在向导里填写（DeepTutor 向导第一步目标为空）。
- 本 Change 中 `mastery/new` 为占位页并展示收到的参数；Change 3′ 实现向导并把它们预选为资料。

### 8. 应用壳：导航、P00、主题与文案
- `app/(tabs)/_layout.tsx` 的 Tab 顺序为「学习」（`index`）、「问答」（`chat`）、「精通之路」（`paths`）、「我的」（`me`），通过 `initialRouteName = "chat"` 默认打开问答。路由名保持不变以减少改动；「学习」「精通之路」页在 Change 6′、3′ 实现前沿用现有占位内容并更新标题与空态文案。
- 移除首次启动跳转 P00 的逻辑，删除 `app/onboarding/scene.tsx` 与 P07 中的场景入口；`AppBootstrapService` 不再读取或保存场景。`settings.curriculum_profile` 保留在数据库中，不删除、不再使用。
- `app/path/new.tsx`、`app/path/[pathId]/workbench.tsx` 改为 `app/mastery/new.tsx`、`app/mastery/[pathId]/index.tsx` 占位，并在 `app/_layout.tsx` 中注册为沉浸式页面。
- `src/theme.ts` 换为 DeepTutor 浅色主题：背景 `#fdfcf9`、主色 `#b0501e`，正文、次要文字、边框与成功/危险色按 `globals.css` 浅色主题取值；卡片圆角 16、大卡片 20。
- 文案从 `web/locales/zh/app.json` 取：「新对话」「停止生成」「重新生成」「添加到对话框」「问 Dito」「小老师 ×{{count}}」「这条消息下的小老师追问」等；Tab 名称按 D7。

### 9. 消息富文本与公式渲染
- 新增 `src/components/MessageContent.tsx`：渲染 Markdown（标题、列表、粗体、代码块、表格）与 LaTeX（`$...$`、`$$...$$`）。优先复用 Cherry Studio Mobile 的 `react-native-enriched-markdown` + `katex` 方案（D1；其 Expo 58 / RN 0.88.1 版本与本仓库一致），流式中使用其流式渲染路径，未闭合的公式或代码块按原文显示。不可用时退回纯 JS Markdown 渲染，公式按原文等宽显示。
- Change 3′ 起的精通会话、题卡与解析复用该组件。

## Risks / Trade-offs

- **[Risk] 侧聊每轮带入最多 24,000 码点父会话记录，增加 token 成本与延迟** → Mitigation：上限与 DeepTutor 一致；父会话较短时按实际长度；真机记录首字延迟。
- **[Risk] 富文本库是原生依赖，需要重建 Dev Client 与 Release APK，包体积会增加** → Mitigation：任务 3.2 先做兼容与体积检查并记录；不兼容时按决策 9 降级。
- **[Risk] 移除 P00 后，依赖 `curriculumProfile` 的代码与测试需要同步修改** → Mitigation：任务 3.1 一并更新 `app-bootstrap` 测试与 Tab 布局。
- **[Risk] `AppBootstrapService.getModelConfig()` 为私有方法** → Mitigation：暴露受控的 `createLf01ChatService()`，不把明文 Key 交给 UI。
