# Design

## Context

参见 `proposal.md`、`docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md` §3.1、§3.4 与 `docs/prd/02-page-layout-interaction.md`。前置 Change 已提供问答（Change 2）、精通会话与路径页（3′、4′）、复习入口与开发时钟（5′）。

DeepTutor 参照（`upstream/deeptutor`）：
- 学习首页：`web/features/ui-layout/modern/LearningDashboard.tsx` 第 33–142 行、`LearningWays.tsx`、`web/lib/mastery-mode.ts`（复习开场消息）。
- 交接：`deeptutor/tools/mastery_nav.py`（只读导航与交接载荷 `_handoff`，第 145–177 行；同一路径会话内拒绝新开会话，第 94–121 行；学习者拒绝时不继续在聊天里辅导，第 185–191 行）、`web/components/chat/home/MasteryHandoffCard.tsx`、`web/lib/mastery-handoff.ts`。
- 文案：`web/locales/zh/app.json`（「该做的事」「{{count}} 项复习已到期」「展开显示」「回到这次会话」「开始学习」「开场说」「从你上次停下的地方继续」「在这条精通之路上另开一次学习」「这条路的进度分毫不失」）。

## Goals / Non-Goals

**Goals:**
- 学习首页的结构与入口和 DeepTutor 一致（只保留精通之路这一种学习形态）。
- 聊天能把学习者带回精通之路，且不写学习数据。
- 所有展示进度与到期数的页面口径一致。

**Non-Goals:**
- 其他学习形态、筛选条、深色主题、备份恢复、加固项。

## Decisions

### 1. 学习首页
- 标题「学习」。「该做的事」按以下顺序列出，最多 5 项：
  1. 有未作答（`awaiting_input` 或 `answered`）题卡的精通会话：显示路径与题干摘要，点击打开该会话；
  2. 有到期复习的路径：显示「{{count}} 项复习已到期」，点击新建复习会话并发送到期开场消息（Change 5′ 的规则）。
- 「学习记录」：全部精通之路卡片，按最近更新排序，显示图标、名称、「已掌握 x / 共 y」与到期数；默认 6 条，「展开显示」加载其余。
- 没有任何路径时显示「精通之路」入口卡片（图标、名称与一句说明），点击打开新建向导。
- 页面获得焦点、应用从后台回到前台、会话回合结束时重新投影。

### 2. 统一的路径摘要
- `learning-home.ts` 导出 `summarizePath(progress, now)`：已掌握数（含自报）、总数、进度百分比（`total > 0 ? round(mastered / total × 100) : 0`，无大纲时界面显示「去定大纲」）、到期数（`dueReviews`）、路径状态（`derivePathStatus`）、下一个动作（`nextObjective` 并以未结束题卡覆盖）。学习首页、精通之路列表、路径页与会话页进度环都只用它。
- `now` 来自 `AppContext` 的共享 `Clock`。

### 3. 聊天中的只读导航工具与交接卡
- 问答主会话（不含小老师侧聊）工具白名单为 `mastery_topics`、`mastery_sessions`、`mastery_open_session`、`mastery_new_session`：
  - `mastery_topics`：返回各路径的 ID、名称、图标、进度、到期数；
  - `mastery_sessions(path_id)`：返回该路径的会话、模式、最近消息时间、是否有未作答题卡；
  - `mastery_open_session(path_id, session_id, opening_message, reason)`：返回「回到会话」交接卡数据；
  - `mastery_new_session(path_id, module_id?, opening_message, reason)`：返回「开始学习」交接卡数据。
  - 四个工具只读，不改变任何学习数据。
- 交接卡数据：`kind`（`open` / `new`）、路径 ID、名称、图标、可选模块名、进度、会话标题与是否有题卡等待作答、`opening_message`、`reason`。保存在该助手消息的 `metadata.handoffs`，重启后可重现。
- 交接卡界面：标题取 `reason`，默认「从你上次停下的地方继续」或「在这条精通之路上另开一次学习」；路径与模块、进度条；「开场说」可编辑文本框；按钮「回到这次会话」（显示会话标题，有题卡等待作答时标注）或「开始学习」（附「这条路的进度分毫不失」）。点击后跳转到对应会话（`new` 新建学习模式会话），并以学习者身份发送「开场说」的内容（为空则不发送）。不点击则什么都不发生。
- 问答提示词补充（Learn Pace 根据 `mastery_nav.py` 的工具说明撰写）：只有学习者想系统地学或复习时才放交接卡；学习者拒绝后不要在聊天里继续按精通之路辅导。

### 4. 收尾
- 各页统一空态、加载态、可重试的错误态与未配置模型的引导；有输入框的页面处理键盘遮挡与底部安全区。
- 清理未实现功能的入口（看板、编辑模块、备份恢复等不显示假按钮；「我的」中的数据管理标注「备份与恢复将在后续版本提供」或不显示）。

## Risks / Trade-offs

- **[Risk] 每次聚焦都读取全部路径进度** → Mitigation：P0 单设备路径数量少；M3 性能测试时再评估缓存。
- **[Risk] 问答中加入工具后，模型可能频繁放交接卡** → Mitigation：提示词限定使用时机；真机走查记录出现频率，必要时收紧提示词。
- **[Risk] 交接卡中的路径或会话可能已被删除** → Mitigation：点击时重新读取，不存在时提示并留在问答。
