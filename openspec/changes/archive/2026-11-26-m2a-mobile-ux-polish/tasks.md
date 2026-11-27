# Tasks

> 建议前置：`refine-mobile-learning-experience` 已归档，避免与工作区 UI 改动交叉。

## 1. Tutor Tool Progress Observation (`packages/app-host`)

- [x] 1.1 在 `packages/app-host/src/chat-turns.ts` 为 `PrepareTurn` 增加可选的纯内存回调 `onToolActivity`（响应 `tool_call` / `tool_result` 并在回合结束自动清空）；在 `packages/app-host/src/mastery/session-service.ts` 导出 `masteryToolStatusLabel(toolName)` 与 `observeActivity(sessionId, listener)`，覆盖 `read_source`、`mastery_profile`、`mastery_build`、`mastery_revise`、`mastery_mode`、`mastery_quiz`、`mastery_grade`、`mastery_assess` 等全部精通工具中文状态文案。在 `packages/app-host/src/__tests__/mastery-session.test.ts` 新增单测断言工具开始/结束事件派发与回合结束后自动清理。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test`。

## 2. Design Tokens, Navigation Shell & Utilities (`apps/mobile`)

- [x] 2.1 在 `apps/mobile/package.json` 安装 Expo 58 匹配的 `expo-clipboard`（`~58.0.4`），扩展 `apps/mobile/src/theme.ts` 补齐语义浅底色（`primarySoft`、`successSoft`、`dangerSoft`、`warning`、`warningSoft`）、统一圆角阶梯与排版字号阶梯；新增 `apps/mobile/src/utils/time.ts` 实现 `formatRelativeTime`（含边界格式单测或类型校验）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 2.2 为 `apps/mobile/app/(tabs)/_layout.tsx` 的四个一级 Tab（「学习 / 问答 / 精通之路 / 我的」）添加统一风格的线性图标，遵循 `tabBarActiveTintColor` / `tabBarInactiveTintColor`；在 `apps/mobile/src/components/MasteryOutline.tsx` 修改 `MasteryProgress`，仅当 `dueCount > 0` 时展示暖色到期徽章，`dueCount === 0` 时隐藏「0 项复习已到期」，并为 `MasteryOutline` 增加可选的 `collapsible` 模块折叠能力（默认展开含当前目标的模块）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。

## 3. Home, Mastery Path & Detail Noise Reduction (`apps/mobile`)

- [x] 3.1 优化 `apps/mobile/app/(tabs)/index.tsx` 与 `apps/mobile/app/(tabs)/paths.tsx`：学习首页为「该做的事」待答与到期项增加语义浅底徽章；精通之路列表改顶栏右侧紧凑「＋ 新建」入口，路径卡片改为整卡可点进入路径页并移除底部全宽「打开精通之路」按钮，仅当 `dueCount > 0` 时在卡片内展示轻量复习入口。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 3.2 重构 `apps/mobile/app/mastery/[pathId]/index.tsx`：将「改名 / 重置进度 / 删除主题」收口至顶栏右侧「···」按钮触发的管理 `ChatSheet`（移除底部全宽「更多」按钮）；大纲开启模块折叠；历史会话改为整行可点击卡片，展示模式标签、单行摘要与 `formatRelativeTime` 相对时间，移除每条会话下方的全宽「打开会话」按钮。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。

## 4. Chat & Mastery Session Micro-Interactions (`apps/mobile`)

- [x] 4.1 在 `apps/mobile/src/components/chat-controls.tsx` 增加次要弱化按钮样式（`subtle`）与共用悬浮 `ScrollToBottomButton`；在 `apps/mobile/src/components/ChatConversation.tsx` 将助手回复底部操作条切换为低权重次要样式、新增一键「复制」全文（调用 `expo-clipboard` 并短暂显示「已复制」），并在上翻历史超过阈值时展示「↓ 回到底部」按钮。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.2 升级 `apps/mobile/app/mastery/[pathId]/session/[sessionId].tsx`：订阅 `mastery.observeActivity(sessionId)` 在多工具运行期间展示带轻加载指示器的实时中文状态（如「正在读取资料…」「正在整理大纲…」）；有消息后自动折叠顶部 `masteryModeNotes[mode]` 释放键盘与对话可视区；在大纲弹层向 `<MasteryOutline>` 传入 `onObjective`，通过互斥弹层状态机点击知识点打开 `ObjectiveEvidence` 抽屉（支持自报掌握与撤销后返回会话）；接入悬浮「↓ 回到底部」按钮。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 5. Android ARM64 Physical Device Verification

- [x] 5.1 重新构建 Android ARM64 Release APK 并安装至真机（`86ceabbf`），核对 9 项体验修复：① 4 Tab 图标与主题语义徽章；② 0 到期时不出现「0 项复习已到期」；③ 「精通之路」整卡可点与顶栏 `+ 新建`；④ 路径页顶栏 `···` 管理菜单（改名/重置/删除）、相对时间与大纲模块折叠；⑤ 问答回复次要操作条、一键复制全文与「↓ 回到底部」；⑥ 精通会话多工具运行期实时中文提示、首条消息后模式说明行自动折叠、大纲弹层点知识点直达证据抽屉。记录 Release APK 体积变化与冷启动结果并追加至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成全部任务与真机复验后归档本 Change，将 6 个能力规格的更新同步至 `openspec/specs/`。
