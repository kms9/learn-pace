## 1. 作答与学习去向

- [x] 1.1 修复 `apps/mobile` 精通会话中的题卡输入焦点、下一题和提交栏，显示当前知识点（01、06）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 1.2 修复 `apps/mobile` 按路径复习入口，调整路径进度、下一步、大纲、复习计划和管理操作的顺序（04、05）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。

## 2. 问答与资料选择

- [x] 2.1 在 `packages/app-host` 添加渲染选文的唯一原文区间定位，接入 `apps/mobile` 原生选区操作和原文确认，调整小老师引用和直达（02、03）。复验 Android 系统只显示标准动作时，选中正文仍能引用和追问。运行 `corepack pnpm typecheck && corepack pnpm test`。
- [x] 2.2 为 `apps/mobile` 问答增加历史搜索和标题、起手草稿示例，为新建向导增加最近会话和资料搜索（07、09、10）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`，真机在键盘展开时可点选历史结果。
- [x] 2.3 调整 `apps/mobile` 交接卡的主按钮与开场编辑顺序，收紧 `packages/app-host` 导师交接提示（08）。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. 统一复验

- [x] 3.1 构建 Android ARM64 Release 并安装到隔离测试包，按提案 01–10 复查，记录真机结果和多路径等特定数据分支的覆盖证据。运行 `corepack pnpm typecheck && corepack pnpm test`，追加验收记录至 `apps/mobile/README.md`。
