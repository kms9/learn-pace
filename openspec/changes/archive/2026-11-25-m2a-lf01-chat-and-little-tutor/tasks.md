# Tasks

## 1. Runtime Multi-Turn Context (`packages/runtime`)

- [x] 1.1 在 `packages/runtime/src/index.ts` 与 `packages/runtime/src/pi-durable-runtime.ts` 为 `RuntimeTurnRequest` 增加可选 `instructions` 与 `history`，通过 `GenerationTask.beforeRequest` 注入按原角色排序的历史；开放 `register_question` 时按 design 决策 1 合并指令；沿用 `allowedTools` 与 M1 行为。运行 `corepack pnpm --filter @learn-pace/runtime typecheck`。
- [x] 1.2 在 `packages/runtime/src/__tests__/runtime.test.ts` 用模拟网关断言请求体中的系统指令、历史角色与顺序、当前提问只出现一次、指令合并顺序、空工具白名单与流式取消终态。运行 `corepack pnpm test`。

## 2. Storage & Chat Host Service (`packages/infra`, `packages/app-host`)

- [x] 2.1 在 `packages/infra/src/{index,memory,expo,migrations}.ts` 加入 SQLite v3：`session_threads` 的 `selection_start`、`selection_end`、`detached_at`；`MessageStore.deleteMessages`、`ThreadStore.deleteThread` / `updateThread`。在 `packages/infra/src/__tests__/migration-sql.test.ts` 与 `memory-store.test.ts` 验证新库、v2 旧线程、M1 数据与部分升级的数据库均可读，删除与解除关联在两种实现中一致。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [x] 2.2 在 `packages/app-host/src/lf01-chat.ts` 实现并导出 `Lf01ChatService`（由 `AppBootstrapService.createLf01ChatService()` 创建）：主会话管理与列表过滤、离线读取、每轮解析模型配置、有界历史、模型记录、片段顺序落库、停止、失败、冷启动恢复、原位重试与重新生成、删除整轮（锚定侧聊解除关联）、引用（`metadata.quotes`，最多 3 条，单条 2,000 码点）。在 `packages/app-host/src/__tests__/lf01-chat.test.ts` 用内存存储与模拟网关覆盖以上行为与同会话并发限制。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test`。
- [x] 2.3 在同一文件实现小老师侧聊：选区精确校验（含重复片段与表情）、创建、列表（区分已关联与已解除关联）、读取、追问（父会话记录取最新、单条 6,000、合计 24,000 码点）、删除、解除关联；以及「转为学习目标」路由载荷（三个参数、摘录 600 码点）。补充测试验证父会话上下文边界、侧聊不改父会话、强杀后恢复。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. App Shell, Theme & Rendering (`apps/mobile`, `packages/app-host`)

- [x] 3.1 应用壳：`apps/mobile/app/(tabs)/_layout.tsx` 改为「学习 / 问答 / 精通之路 / 我的」并 `initialRouteName = "chat"`；删除 P00 跳转、`apps/mobile/app/onboarding/scene.tsx` 与 `app/(tabs)/me.tsx` 中的场景入口；`AppBootstrapService` 去掉场景快照与保存，更新 `packages/app-host/src/__tests__/app-bootstrap.test.ts`；`app/path/new.tsx`、`app/path/[pathId]/workbench.tsx` 改为 `app/mastery/new.tsx`、`app/mastery/[pathId]/index.tsx` 占位并在 `app/_layout.tsx` 注册；`src/theme.ts` 换为 DeepTutor 浅色主题并更新现有页面文案。运行 `corepack pnpm typecheck && corepack pnpm test`。
- [x] 3.2 新增 `apps/mobile/src/components/MessageContent.tsx`：Markdown 与 LaTeX 渲染，流式中未闭合片段按原文显示。先验证 `react-native-enriched-markdown` + `katex` 的兼容性与 Release APK 体积增量，不兼容时按 design 决策 9 降级，结论记入 `apps/mobile/README.md`。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。

## 4. Chat & Little Tutor UI (`apps/mobile`)

- [x] 4.1 `apps/mobile/src/context/AppContext.tsx` 持有唯一的 `Lf01ChatService`。升级 `apps/mobile/app/(tabs)/chat.tsx`：顶部会话列表弹层、「新对话」、模型状态与未配置时的 P07 引导；消息流用 `MessageContent` 渲染，展示生成、停止、失败、重试状态；最后一条回复「重新生成」；整轮删除（确认）；长按消息打开选文确认层（「添加到对话框」「问 Dito」「转为学习目标」）；输入框引用条；锚点消息下「小老师 ×N」列表（打开、删除、解除关联）；会话菜单「小老师记录」。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.2 新增 `apps/mobile/app/chat/thread/[threadId].tsx` 并在 `app/_layout.tsx` 注册：顶部选文、预填未发送的输入框、多轮追问、停止、重试、侧聊内「添加到对话框」；返回时保留父会话草稿与滚动位置。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 5. Android ARM64 Physical Device Verification (AC-01 & AC-02)

- [x] 5.1 在 Android 真机（`86ceabbf`，`ANDROID_HOME=$HOME/Library/Android/sdk`）验证 **AC-01**：冷启动直接进入「问答」且无场景选择；新对话完成两轮（其中一轮含公式）；停止、重新生成、删除整轮各一次；生成中执行 `adb shell am force-stop app.learnpace.m1`，重启确认历史、模型 ID 与已存片段恢复且需手动重试。
- [x] 5.2 在同一真机验证 **AC-02**：选文「问 Dito」确认预填未发送，追问一轮并核对回答能引用父会话内容；返回核对父会话草稿与滚动位置；强杀重启后从「小老师 ×1」重开；解除关联与删除各一次；选文「添加到对话框」后发送，确认引用条随消息显示；「转为学习目标」进入 `mastery/new` 占位并显示参数。将结果追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成全部任务与真机验收后归档本 Change，将 `lf01-chat`、`little-tutor-threads`、`app-visual-identity` 同步为主规格，并合并对 `app-navigation`、`model-settings`、`local-storage` 的修改。
