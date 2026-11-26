# Design

## Context

参见 `proposal.md`。M2-A 全流程与 `refine-mobile-learning-experience` 已补齐核心功能与关键交互修复（原生渲染选区、题卡键盘提交栏、按路径复习、搜索与起手示例、交接卡顺序）。本 Change 聚焦剩余 9 项移动端成品感、视觉减噪与导师过程透明化改进，保持 `packages/domain`、`packages/infra` 与 `packages/runtime` 契约零变更。

## Goals / Non-Goals

**Goals:**
- 建立统一的视觉 Token（语义浅底色、排版字号阶梯、圆角规范）与 4 Tab 线性图标，消除页面“大按钮堆砌”和「0 项复习已到期」噪音。
- 降低聊天回复操作条视觉权重，补齐一键「复制」与长对话「↓ 回到底部」。
- 透传纯内存的导师工具执行状态，让 4–14 秒多工具回合对学习者透明；回收精通会话顶部可视空间，并打通会话大纲弹层到证据抽屉的查看链路。

**Non-Goals:**
- 不做 SQLite 事务、CAS、幂等、崩溃对账与备份恢复（M2-B Change 7–9）。
- 不修改数据库 Schema、不持久化工具中间态（工具活动状态仅存在于回合运行期的内存中）。
- 不新增第二波功能（拍照/PDF 导入、推送通知、主动提问、深色主题）。

## Decisions

### 1. 设计 Token、Tab 图标与剪贴板依赖
- **Token 扩展（`apps/mobile/src/theme.ts`）**：在既有 DeepTutor 浅色主题基础上增加：
  - 语义浅底色：`primarySoft`（`#faeae1`）、`successSoft`（`#e7f4ec`）、`dangerSoft`（`#fbeae8`）、`warning`（`#b4690e`）、`warningSoft`（`#fdf3e3`）；
  - 圆角阶梯：`radius = { sm: 8, md: 12, card: 16, large: 20, pill: 999 }`；
  - 排版阶梯：`typography = { pageTitle, sectionTitle, body, caption, micro }`，逐步替换各页面硬编码字号。
- **底部 4 Tab 图标（`apps/mobile/app/(tabs)/_layout.tsx`）**：选用纯 RN 轻量几何/线性组件或 `@expo/vector-icons`（优先不引入额外 C++ 原生库；若引入 `@expo/vector-icons` 或 `react-native-svg`，须在 Android Release 构建实测 APK 增量，确保增量可控）。4 个 Tab 分别对应「学习（书本/指南）」「问答（对话气泡）」「精通之路（路线/罗盘）」「我的（设置/个人）」，统一 `22px` 尺寸与 `tabBarActiveTintColor` / `tabBarInactiveTintColor`。
- **一键复制（`expo-clipboard`）**：引入 Expo 58 官方匹配的 `expo-clipboard`（`~58.0.4`，与 Cherry Studio Mobile 一致），调用 `Clipboard.setStringAsync(message.content)` 并在 1.5 秒内将按钮标签切换为「已复制」。

### 2. 列表、路径页减噪与相对时间
- **零到期静默（`MasteryOutline.tsx`）**：`MasteryProgress` 仅在 `dueCount > 0` 时渲染到期徽章（使用 `warningSoft` 底色 + `warning` 文字），`dueCount === 0` 时不占行高。
- **学习首页（`apps/mobile/app/(tabs)/index.tsx`）**：「该做的事」为待作答/待评分项添加 `primarySoft` 语义标签，为到期复习项添加 `warningSoft` 标签；「学习记录」复用无零到期噪音的 `MasteryProgress`。
- **精通之路（`apps/mobile/app/(tabs)/paths.tsx`）**：页面顶栏改为标题行 + 右侧紧凑「＋ 新建」按钮；路径卡片改为整体 `Pressable`（点击直接进入路径页），移除底部全宽「打开精通之路」按钮；仅当 `topic.dueCount > 0` 时在卡片底部渲染紧凑的到期复习条/操作。
- **路径页（`apps/mobile/app/mastery/[pathId]/index.tsx`）**：
  - 将「改名」「重置进度」「删除主题」收口进导航顶栏右侧的 `···` 图标按钮触发的 `ChatSheet`（移除底部全宽「更多」按钮）；点击「改名」弹出轻输入弹层或原位表单；
  - 新增 `apps/mobile/src/utils/time.ts` 的 `formatRelativeTime(timestampSeconds, nowSeconds)`：`< 1 分钟`「刚刚」、`< 1 小时`「N 分钟前」、`< 24 小时`「N 小时前」、`昨天`「昨天 HH:mm」、今年「M 月 D 日」、跨年「YYYY 年 M 月 D 日」；
  - 历史会话每条改为整行 `Pressable`（左侧模式小徽章 + 最近消息单行摘要 + 右侧相对时间与轻箭头），移除每条下方全宽「打开会话」按钮；
  - `MasteryOutline` 增加可选 `collapsible?: boolean`（默认在路径页开启）：按模块支持点击标题折叠/展开，默认展开包含 `current` 知识点的模块（无 `current` 时默认展开第一个未全部掌握的模块）。

### 3. 对话操作条次要化与「↓ 回到底部」
- **回复操作条（`ChatConversation.tsx`）**：将 `ChatAction` 增加 `subtle?: boolean` 样式（`colors.muted` 文字、更紧凑的 `36px` 触控高度或轻量图标+文字），应用于已完成助手回复下方的「选文」「复制」「重新生成」「删除整轮」（仅「删除整轮」或「重试」在强调时保留语义色），避免满屏主色橙字抢正文焦点。
- **悬浮回底按钮**：在 `ChatConversation.tsx` 与 `session/[sessionId].tsx` 共用一个轻量 `ScrollToBottomButton`：当 `contentSize.height - contentOffset.y - layoutMeasurement.height > 160` 时显示在输入框右上方，点击后 `scrollToEnd({ animated: true })` 并重新置 `follow.current = true`。

### 4. 精通会话工具状态透传、紧凑顶栏与交互式大纲弹层
- **纯内存工具活动观察器（`packages/app-host`）**：
  - `ChatTurns` 的 `PrepareTurn` 增加可选回调 `onToolActivity?: (activity: { toolName: string; phase: "started" | "finished" }) => void`，在 `runtime.runTurn` 收到 `tool_call` / `tool_result` 时同步派发，回合结束时清空；
  - `MasterySessionService` 暴露只读方法 `observeActivity(sessionId, listener)` 与共享映射表 `masteryToolStatusLabel(toolName)`：
    - `read_source` → 「正在读取资料…」
    - `mastery_profile` → 「正在更新学习档案…」
    - `mastery_build` → 「正在整理大纲…」
    - `mastery_revise` → 「正在修订大纲…」
    - `mastery_mode` → 「正在切换模式…」
    - `mastery_quiz` → 「正在准备题目…」
    - `mastery_grade` → 「正在批改作答…」
    - `mastery_assess` → 「正在评估你的解释…」
    - `mastery_status` → 「正在查看学习进度…」
    - `mastery_note_explained` / `mastery_defer_objective` / `mastery_skip_question` / `mastery_repair_question` → 对应简短中文提示；兜底「正在处理…」。
  - 当正在生成回复且存在活跃工具时，界面在「正在生成…」位置展示该阶段标签（带轻 `ActivityIndicator`）；收到 `text_delta` 或工具结束后自动回到流式正文或「正在生成…」。不落盘 SQLite。
- **顶部模式说明自动折叠（`session/[sessionId].tsx`）**：仅当 `messages.length === 0` 时展示 `masteryModeNotes[mode]`；已有消息后自动隐藏（保留顶部模式分段切换与当前知识点行），显著改善弹起键盘后的对话可视面积。
- **会话内大纲弹层直达证据抽屉**：在 `session/[sessionId].tsx` 的大纲 `ChatSheet` 中给 `<MasteryOutline>` 传入 `onObjective`，复用路径页的 `ObjectiveEvidence` 抽屉组件（加载 `mastery.objectiveEvidence(pathId, id)` 并支持自报掌握与撤销），关闭证据抽屉后回到当前会话且不丢失草稿与滚动位置。

## Risks / Trade-offs

- **[Risk] 引入 `expo-clipboard` 属于新增原生模块，需要重新构建 Android Dev Client / Release APK** → Mitigation：任务 4.1 明确执行真机重建并核对 Release APK 体积与冷启动基线（较 36.64 MiB 基线增量控制在合理范围）。
- **[Risk] 路径页改用顶栏 `···` 菜单后，既有依赖底部「更多」按钮的测试或用户习惯可能变化** → Mitigation：菜单入口提供清晰 `accessibilityLabel="更多操作"`，弹层内完整保留「改名」「重置进度」「删除主题」与原有二次确认弹窗。
- **[Risk] 大纲弹层再叠证据抽屉在 Android `Modal` 嵌套时可能触发关闭冲突** → Mitigation：点击大纲中的知识点时先关闭大纲 `ChatSheet`（或在同一状态机 `modal: "outline" | { kind: "evidence", objectiveId }` 中互斥切换），避免双层原生 `Modal` 叠加。
