# Proposal

## Why

前面的 Change 交付了问答、精通之路列表、精通会话与复习，但「学习」Tab 仍是占位，聊天里也还不能把学习者带回精通之路。DeepTutor 的学习首页由「该做的事」（到期复习、等待作答的会话）与「学习记录」组成；聊天中的导师可以用只读导航工具放置交接卡，让学习者回到某条精通之路的会话或另开一次学习。本 Change 补齐这两处，统一跨页数字口径，并完成 M2-A 全链路真机走查。

## What Changes

- **学习首页（「学习」Tab，`apps/mobile`、`packages/app-host`）**：
  - 「该做的事」：有到期复习的精通之路（「N 项复习已到期」，点击进入复习会话并发送到期开场消息）；有未作答题卡的会话（点击回到该会话）；
  - 「学习记录」：全部精通之路卡片（图标、名称、进度、到期数），超过 6 条时「展开显示」；
  - 空态：「精通之路」入口卡片，点击打开新建向导；
  - 进入页面与应用回到前台时刷新。
- **聊天交接卡（`packages/app-host`、`apps/mobile`，修改 `lf01-chat`）**：
  - 问答工具白名单加入 DeepTutor 的只读导航工具 `mastery_topics`、`mastery_sessions`、`mastery_open_session`、`mastery_new_session`；
  - 回复中渲染交接卡：路径、可选的模块、进度、会话状态、可编辑的「开场说」，按钮「回到这次会话」或「开始学习」；
  - 点击后跳转并以学习者身份发送开场内容；工具本身不写数据、不自动跳转。
- **跨页一致与收尾**：
  - 学习首页、精通之路列表、路径页、精通会话的进度与到期数使用同一投影函数与同一 `Clock`；
  - 补齐各页空态、加载态、错误态、键盘与安全区；
  - 清理未实现功能的占位入口。
- **M2-A 全链路真机走查**。

### Out of Scope（本 Change 明确不做）
- DeepTutor 学习首页中的书籍、阅读、练习等其他学习形态与筛选条。
- 深色主题、看板视图、手工编辑模块、自定义复习间隔编辑器。
- 备份与恢复（M2-B Change 9）；事务、CAS 与故障注入（M2-B Change 7–8）。

## Capabilities

### New Capabilities
- `learning-home`: 学习首页（该做的事、学习记录、空态、刷新）与跨页进度一致性。
- `mastery-handoff`: 聊天中的精通之路只读导航工具与交接卡。

### Modified Capabilities
- `lf01-chat`: 问答工具白名单由空改为只读的精通之路导航工具，仍不写入任何学习数据。

## Dependencies

- Change 2、3′、4′、5′ 已归档。

## Impact

- **`packages/app-host`**：新增 `learning-home.ts`（首页投影与共用的路径摘要函数）、`mastery/nav-tools.ts`（四个只读导航工具）；`lf01-chat.ts` 注册导航工具并在回复中携带交接卡数据；测试。
- **`apps/mobile`**：`app/(tabs)/index.tsx`（学习首页）、`src/components/mastery/HandoffCard.tsx`、`app/(tabs)/chat.tsx` 渲染交接卡；各页面统一使用路径摘要函数与刷新机制。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm test` 全绿；Android 真机完成 M2-A 全链路走查（AC-01–04、AC-06）。
