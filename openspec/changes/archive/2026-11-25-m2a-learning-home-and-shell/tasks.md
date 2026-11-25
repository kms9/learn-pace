# Tasks

> 前置：Change 2、3′、4′、5′ 已归档。

## 1. Projections & Handoff Tools (`packages/app-host`)

- [x] 1.1 新增 `packages/app-host/src/learning-home.ts`：`summarizePath(progress, now)` 与首页投影（该做的事：未作答题卡的会话、到期路径；学习记录）。在 `__tests__/learning-home.test.ts` 用 `MemoryAppStore` + `FakeClock` 覆盖排序与上限、自报掌握计入、到期数、复习失败后数字变化、无路径空态。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test`。
- [x] 1.2 新增 `packages/app-host/src/mastery/nav-tools.ts`（四个只读导航工具，载荷按 design 决策 3），在 `lf01-chat.ts` 的问答主会话中注册（侧聊不注册），把交接卡数据存入助手消息 `metadata.handoffs`；补充问答提示词。在 `__tests__/lf01-chat.test.ts` 覆盖工具不写学习数据、交接卡落库与恢复、侧聊无工具。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 2. UI (`apps/mobile`)

- [x] 2.1 `apps/mobile/app/(tabs)/index.tsx`：学习首页（该做的事、学习记录与「展开显示」、空态入口卡片、聚焦 / 回前台 / 回合结束刷新）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 2.2 新增 `apps/mobile/src/components/mastery/HandoffCard.tsx` 并在 `app/(tabs)/chat.tsx` 渲染：标题、路径与模块、进度、会话状态、可编辑「开场说」、按钮行为与目标不存在的提示。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 2.3 统一精通之路列表、路径页与会话进度环改用 `summarizePath`；补齐各页空态、加载态、错误态、未配置模型引导、键盘与安全区；清理未实现功能的占位入口。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. M2-A End-to-End Physical Device Walkthrough

- [x] 3.1 在 Android 真机（`86ceabbf`）用全新安装执行 M2-A 全链路走查：① 未配置模型时各 Tab 空态与引导、冷启动进入「问答」；② 配置 DeepSeek Flash 后：问答与小老师 → 「转为学习目标」→ 编辑大纲会话 → 学习模式达标一个知识点 → 调试时钟使其到期 → 从学习首页「该做的事」进入复习 → 答错回落 → 学习首页数字变化；③ 在问答中请导师带回该路径，点交接卡进入会话；④ 核对学习首页、精通之路列表、路径页与会话进度一致；⑤ 复测 Release APK 体积与冷启动时间。结果追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `learning-home`、`mastery-handoff` 同步为主规格并合并 `lf01-chat` 的修改，标志 M2-A 达成，随后进入 M2-B（Change 7–9）。
