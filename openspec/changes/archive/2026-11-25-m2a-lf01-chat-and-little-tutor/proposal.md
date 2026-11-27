# Proposal

## Why

产品目标已调整为「打开应用即是 DeepTutor 的手机版」（D8）。Change 1 已搭建 4 Tab、P07 与 SQLite 底座，但「问答」Tab（P02）只是只读历史占位，应用导航、视觉和文案也还是 V0.2 的样子。本 Change 交付与 DeepTutor 聊天一致的问答体验（多轮流式、停止、重新生成、小老师侧聊、添加到对话框），同时把应用壳切换为 DeepTutor 的导航、主题与文案（AC-01、AC-02）。

## What Changes

- **Runtime 多轮对话支持（`packages/runtime`）**：为 `RuntimeTurnRequest` 增加可选 `instructions` 与有界 `history`，保持 M1 行为兼容。问答主会话与小老师侧聊使用空工具白名单。
- **问答与小老师应用服务（`packages/app-host`）**：新增 `Lf01ChatService`：
  - 会话管理、完整本地历史、每轮实际模型 ID、流式停止、失败与强杀后恢复、原位重试；
  - 重新生成最后一条回复、删除整轮；
  - 「添加到对话框」：选文作为引用随下一条消息发送；
  - 小老师侧聊：以选文所在消息为锚点，带入父会话到最新一条的有界记录（每条 ≤6,000、合计 ≤24,000 个 Unicode 码点），可打开、删除、解除关联；
  - 「转为学习目标」的路由载荷（交给 Change 3′ 的新建向导）。
- **应用壳与视觉（`apps/mobile`，修改 `app-navigation` 等主规格）**：
  - 4 Tab 改为「学习 / 问答 / 精通之路 / 我的」，默认打开「问答」；
  - 移除 P00 学习场景选择（已保存的设置保留不用）；
  - 路由 `path/new`、`path/[pathId]/workbench` 改为 `mastery/new`、`mastery/[pathId]` 占位，供 Change 3′ 实现；
  - 主题改为 DeepTutor 配色，界面文案采用 DeepTutor 中文原文；
  - 新增共享的 Markdown 与公式渲染组件。
- **P02 问答与小老师界面（`apps/mobile`）**：会话列表弹层、新对话、模型状态、消息流、停止生成、重新生成、重试、删除整轮；长按消息选文 →「添加到对话框」「问 Dito」「转为学习目标」；消息下「小老师 ×N」标记；小老师侧聊页面。

### Out of Scope（本 Change 明确不做）
- 新建精通目标向导、精通会话与路径页（Change 3′ `m2a-mastery-topics-and-outline` 起）；本 Change 只把「转为学习目标」导航到 `mastery/new` 占位页并传参。
- 聊天中的精通之路导航工具与交接卡（Change 6′ `m2a-learning-home-and-shell`，需要路径与会话存在）。
- LF01-05 可选理解验证（参照 DeepTutor「主动提问」，P0 待排期，不计入掌握度）。
- 消息编辑与分支切换、跨消息选区、能力选择器（解题、研究等）、语音朗读、附件（P0 仅文本与选文）。
- 深色主题（先只提供 DeepTutor 浅色主题）。
- SQLite 多表原子事务、严格 `submission_id` 幂等与跨库崩溃对账（D3，留待 M2-B）。
- 不将问答或小老师内容写入精通之路的掌握度或学习证据。

## Capabilities

### New Capabilities
- `lf01-chat`: 问答多轮会话（新建、列表弹层、历史恢复、流式、停止、中断、重试、重新生成、删除整轮）、「添加到对话框」引用、空工具白名单，以及「转为学习目标」的跳转载荷。
- `little-tutor-threads`: 小老师侧聊（选文锚点、父会话有界上下文、预填不自动发送、重开、删除、解除关联、不写回父会话）。
- `app-visual-identity`: DeepTutor 浅色主题、中文文案与 Markdown/公式渲染。

### Modified Capabilities
- `app-navigation`: Tab 名称与默认页改变；移除 P00 场景选择；沉浸式路由改为精通之路占位路由。
- `model-settings`: 未配置模型时的本地浏览场景随 Tab 改名更新。
- `local-storage`: 强杀恢复场景不再涉及场景偏好。

## Impact

- **`packages/runtime`**：`RuntimeTurnRequest` 增加 `instructions`、`history`，`PiDurableRuntime` 通过 `GenerationTask.beforeRequest` 注入。
- **`packages/infra`**：SQLite v3 为 `session_threads` 增加 `selection_start`、`selection_end`、`detached_at`，并新增按会话删除消息、删除线程的方法；内存与 Expo 实现对齐。
- **`packages/app-host`**：新增 `lf01-chat.ts`；`AppBootstrapService` 不再提供场景快照与保存方法，暴露受控的问答服务创建方法。
- **`apps/mobile`**：`src/theme.ts`、`app/(tabs)/_layout.tsx`、`app/_layout.tsx`、`app/(tabs)/chat.tsx`、`app/(tabs)/me.tsx`、`src/context/AppContext.tsx`；新增 `app/chat/thread/[threadId].tsx`、`src/components/MessageContent.tsx`、`app/mastery/new.tsx` 与 `app/mastery/[pathId]/index.tsx` 占位；删除 `app/onboarding/scene.tsx`、`app/path/` 旧占位。
- **下游**：Change 3′ 起的精通会话复用本 Change 的 runtime 扩展、消息状态规则与 `MessageContent`。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm test` 全绿；Android ARM64 真机完成 AC-01、AC-02。
