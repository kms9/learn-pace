# DeepTutor 与 Learn Pace 学习流程源码对照（V0.2）

评估日期为 2026-11-25。上游基线为仓库检出的 DeepTutor `1284116` 和 DeepTutor Lite `5082b93`。Learn Pace 实现基线为 `c26ef57`，规格以评估时工作区内的 M2-A Change 2–6 为准。本文分别记录产品需求、已写入变更的设计和代码已实现的行为。流程映射为 LF01 自由问答与 Little Tutor，以及 LF02 Mastery Path 的 Outline、Study、Review。

## 结论

- **LF01 核心流程相近，交互差异中等。** 两边都有多轮对话、流式输出、历史和选文子会话。Learn Pace 将父上下文限制为选文及来源提问，并由本地存储恢复中断，支持用户确认后回引或从选文创建目标。
- **LF02 保留核心评估语义，产品编排差异较大。** 题卡落库即结束本轮、定量掌握门槛与间隔算法均有上游依据。Learn Pace 把上游导师驱动的会话编排收敛为手机端表单、明确确认、Host 准入和专用复习队列。
- **数值一致性的边界是领域算法。** 现有黄金样本验证掌握度计算和一条 `memory` 调度轨迹。评分如何生成证据、何时调度、何时退出复习队列，仍需按 Change 的应用层验收验证。[数值对照测试](../../packages/domain/src/__tests__/parity.test.ts#L33) · [M2 路线图](../../openspec/ROADMAP.md)

## LF01 · 自由问答与 Little Tutor

| 环节 | DeepTutor 官方源码行为 | Learn Pace PRD 与 Change 2 | 差异 |
| --- | --- | --- | --- |
| 多轮、停止与恢复 | Web 客户端记录回合 ID 和事件序号，连接恢复后续接事件流；停止等待服务端释放当前回合 | SQLite 保存原提问、回复增量、终态和实际模型 ID。强杀后恢复已存片段，用户手动重试，原位更新回复。有界历史按原角色装配 | 日常交互接近，恢复机制差异中等 |
| 选文与上下文 | 渲染正文支持跨消息选区，从 KaTeX 还原公式。默认 Dito 可读取当前分支的有界父上下文，也可打开整段对话的侧聊 | 只锚定一条已完成的助手消息，按原文 UTF-16 区间定位。子会话读取选文、来源回复对应的提问和自身历史 | 子会话隔离一致，上下文范围与选文操作差异中等 |
| 返回与回引 | 侧聊保存为独立会话，原消息可重开已关联线程，并可解除关联或更换锚点 | 独立页面返回原会话的草稿和滚动位置。显式确认后，可把子会话回复的摘录追加为带来源的用户引用 | 回引是 Learn Pace 的新增交互 |
| 从问答进入学习 | 普通聊天的导航工具只读。交接卡由用户点击，进入已有路径的新会话或已有会话 | 「转为学习目标」把来源会话、消息、选文和建议目标带到 P04，确认后创建新路径草稿 | 都由用户确认，目标及后续业务不同 |

上游依据见[Web 运行时](../../upstream/deeptutor/web/features/chat/transport/TurnRuntimeClient.ts#L282)、[事件续接](../../upstream/deeptutor/web/features/chat/transport/TurnRuntimeClient.ts#L563)、[正文选文](../../upstream/deeptutor/web/features/chat/components/ChatWorkspace.tsx#L1794)、[公式还原](../../upstream/deeptutor/web/lib/selection-text.ts#L47)、[侧聊父上下文](../../upstream/deeptutor/deeptutor/services/session/_turn_runtime_shared.py#L1219)和[路径交接工具](../../upstream/deeptutor/deeptutor/tools/mastery_nav.py#L11)。

Learn Pace 的移动端选区以存储的消息原文为准，避免用渲染后文本直接计算偏移。真机应覆盖重复片段、表情、Markdown 和公式，并验证关闭子会话与确认回引这两条路径。PRD 的可选「理解验证」仍需明确阶段归属。Change 2 已规定普通问答与 Little Tutor 使用空工具白名单，尚未定义正式的「出题、作答、反馈」交互。Lite 的 `ui_ask` 是可参考的对话交互，其结果需要与 LF02 掌握证据保持隔离。[LF01 PRD](../prd/03-lf01-exploration-flow.md#L13) · [Change 2 设计](../../openspec/changes/m2a-lf01-chat-and-little-tutor/design.md#L25) · [Lite 工具指令](../../upstream/deeptutor-lite/src/agent/harness.ts#L35)

## LF02 · 目标、大纲、Study 与 Review

| 环节 | DeepTutor 官方源码行为 | Learn Pace PRD 与 M2-A Change | 差异 |
| --- | --- | --- | --- |
| 目标与大纲 | 两步创建空目标，进入 Outline 会话协商。已确认的大纲可通过带版本校验的预览和提交修订 | Change 3 在 P04 收集目标、学习背景和可选文本／选文资料。在 P06 生成、保存和恢复结构化预览，学习者确认后开放 Study。M2-A 的已确认大纲只读 | 生命周期接近，协商与修订交互差异大 |
| 选点与先修 | 官方 `next_objective` 先处理待答、再推荐到期复习，随后按模块顺序选目标。该函数本身不检查先修。Lite 的选点函数检查先修 | Change 3 定义 `selectStudyObjective`，Change 4 用它检查先修和延期。Host 从 `interactions` 读开放题卡，Review 使用独立入口 | 明确的产品策略差异，算法移植本身无法覆盖 |
| 题卡与作答时序 | 正式 Mastery 卡先落库再结束本轮。下一轮以结构化提交携带原题和答案，后端可以直接评分。Lite 的 `ctx.ask` 会在工具内等用户选择，由 Agent 继续调用评分 | Change 4 延续正式卡时序。Host 负责路径、会话、模式与目标绑定，保存原答案后才评分。P06 可恢复待答和待评分状态 | 官方主仓语义接近，Lite 的等待方式不同 |
| 定量、定性与反馈 | 定量用最近五次有效独立作答计算掌握度。概念／设计练习卡与正式费曼评估分开，正式评估使用真实用户原文，可处理澄清回复和来源校验 | Change 4 收敛为定量选择题与定性开放题。定性落库原答案、Rubric、依据、满足标准和模型 ID。提示、待答时追问记录辅助曝光 | 定量规则接近，定性输入与反馈编排差异较大 |
| 复习与补救 | 官方从路径详情打开 Review 对话，评分服务可从首次评分起更新调度，也能重算掌握状态 | Change 4／5 共用评分。Change 5 展示到期队列、按需提示、答后反馈、结算和补救跳转。Change 6 用相同投影口径更新首页与路径详情 | 调度算法接近，队列、结算与移动端导航差异大 |

上游依据见[目标创建](../../upstream/deeptutor/web/components/space/learning/CreateTopicWizard.tsx#L90)、[大纲预览与修订](../../upstream/deeptutor/deeptutor/learning/service.py#L1945)、[官方选点](../../upstream/deeptutor/deeptutor/learning/policy.py#L281)、[Lite 先修选点](../../upstream/deeptutor-lite/src/tools/mastery.ts#L519)、[题卡终止](../../upstream/deeptutor/deeptutor/capabilities/mastery/tools.py#L1488)、[先存答案](../../upstream/deeptutor/deeptutor/services/session/turns/learning_adapter.py#L74)、[定性评估](../../upstream/deeptutor/deeptutor/capabilities/mastery/tools.py#L2085)、[复习入口](<../../upstream/deeptutor/web/app/(workspace)/learning/mastery/[pathId]/page.tsx#L371>)和[Lite 题卡选择器](../../upstream/deeptutor-lite/src/tools/mastery.ts#L779)。

Lite 的诊断可以插入虚拟正确记录，定性工具也能接收 Agent 给出的 `passed`。Learn Pace 的诊断只使用真实作答，定性评估使用保存的答案和结构化结果，由 Host 与本地领域规则决定掌握推进。官方主仓的定性工具以服务端评估为准，忽略旧版 `passed` 参数。[Lite 诊断](../../upstream/deeptutor-lite/src/tools/mastery.ts#L1622) · [Lite 定性工具](../../upstream/deeptutor-lite/src/tools/mastery.ts#L1340) · [官方定性工具](../../upstream/deeptutor/deeptutor/capabilities/mastery/tools.py#L2085) · [Learn Pace Runtime 契约](../prd/06-agent-runtime-contract.md#L19)

## Study 与 Review 的共同验收口径

| 核对项 | 源码依据与 Learn Pace 验收 |
| --- | --- |
| 首次评分与首次可见复习 | 官方评分服务从首次评分起初始化并调度。Change 4 按每次有效评分推进已有状态，只向用户展示已达标目标的可复习任务。同一调度窗口内连续答对可增加调度计数，稳定度和到期日沿用。首次达标使用已累计的状态 |
| 辅助作答 | 两种模式共用一套证据质量规则。辅助答对时在评分层一次性封顶 `0.60`，显式传给调度器。仅设置 `hints_used` 而继续传 `quality: 1` 不会产生扣分。用相同初始状态在窗口外比较辅助答对与无提示独立答对，窗口内两者都可保持原间隔 |
| 失去门槛与保持风险 | 独立复习进入共用门槛。用现有公式复算，三次定量独立答对为 `100%`，再独立答错一次约为 `71.4%`。定性 `partial` 会使掌握回落，其 `quality = 0.5` 恰好等于失误阈值，故不能据此断言 `lapse_count` 增加。辅助作答保留原掌握结论 |
| 补救与再入队 | OpenSpec 已采用掌握回落后退出可见复习队列、保留历史、从 Review 跳回 Study 的做法。补救入口以原知识点为焦点，服从先修准入和待答恢复。重新达标时按当前保存的调度状态回到复习队列。用户结算以实际处理的 Review 题卡为准 |

上游依据见[定量评分与调度](../../upstream/deeptutor/deeptutor/learning/service.py#L580)和[定性状态更新](../../upstream/deeptutor/deeptutor/learning/service.py#L2928)。Learn Pace 依据见[质量解析](../../packages/domain/src/scheduler.ts#L109)、[同会话与失误分支](../../packages/domain/src/scheduler.ts#L326)、[Change 3 先修准入](../../openspec/changes/m2a-lf02-goal-and-outline/design.md#L38)、[Change 4 评分管线](../../openspec/changes/m2a-lf02-study-and-assessment/design.md#L53)、[Change 5 复习与补救](../../openspec/changes/m2a-lf02-review-loop/design.md#L23)和[Change 6 首页投影](../../openspec/changes/m2a-home-projections-and-polish/design.md#L20)。

## 当前代码与验证边界

- **已落地**。Change 1 的四 Tab、SQLite、SecureStore，M1 的 Pi Durable 流式取消、公开题卡及比例题恢复与规则评分。M1 验证工作台仍使用其独立的证据重放路径。[M1 工作台](../../packages/app-host/src/study-workbench.ts#L143) · [Android 验收记录](../../apps/mobile/README.md#L35)
- **已规划**。P02 正式问答和 Little Tutor、P04 正式建目标、P06 正式 Outline／Study／Review、跨页投影和真机完整闭环。当前 P02 为只读历史入口，P04 与 P06 为占位界面。[P02](<../../apps/mobile/app/(tabs)/chat.tsx#L6>) · [P04](../../apps/mobile/app/path/new.tsx#L4) · [P06](<../../apps/mobile/app/path/[pathId]/workbench.tsx#L6>)
- **验证证据**。源码审查时 `corepack pnpm test` 的 59 项测试全部通过。跨项目数值断言、当前首期运行时测试和 M1 真机记录分别提供局部证据。完整流程验收依据 AC-01、AC-02、AC-03、AC-04 与 AC-06。[验收标准](../prd/09-acceptance-criteria.md#L7)
