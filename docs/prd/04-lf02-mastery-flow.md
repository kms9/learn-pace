# 04 · LF02 Mastery Path 掌握学习

> V0.2 拟议产品设计基线（2026-11-24）。源自 PRD V0.1 和 V0.2 闭环复评；非已实现功能或已通过工程验收。遇到 V0.1 原型与 V0.2 约束冲突，以 V0.2 为拟议修订基线。参见 [复评](../evaluation/learning-loop-review-v0.2.md) 与 [设计索引](../design/README.md)。

## 6. LF02：目标规划、掌握学习与复习

### 6.1 业务闭环及核心功能

目标创建 → Outline 大纲协商/确认 → Study 选择合适知识点 → 诊断或教学 → 练习/解释验证 → 评分与能力证据 → 掌握门禁 → 补救或进阶 → 复习安排 → Review 独立提取/评估 → 更新保持状态与复习任务 → 再次进入学习。路径完成不代表复习生命周期结束。

| 需求 ID | 功能 | 验收标准 |
| --- | --- | --- |
| LF02-01 | 目标及路径 | 空路径可保存并恢复；大纲有模块、知识点、稳定 ID 和来源；依赖可校验 |
| LF02-02 | Outline 确认/修订 | 变更预览并提交 Revision；重排不丢证据；重写、删除明确影响范围 |
| LF02-03 | 学习前置状态 | 每轮先读最新快照；根据学习偏好/证据选择诊断、教学、练习或评估 |
| LF02-04 | 教学与纠错 | 解释、支架、提示、错误诊断与补救学习，区分被指导作答与独立表现 |
| LF02-05 | 结构化题卡 | 题目、评分依据和 ID 持久化后出题即结束本轮；作答先保存，允许中断和恢复 |
| LF02-06 | 评估与掌握 | 规则评分或模型辅助评估；记录原文、依据、证据来源；本地门禁决定进阶 |
| LF02-07 | 异议、跳过、修复 | 跳过/延期不是掌握；无效题可作废、重新计算状态及复习计划 |
| LF02-08 | 间隔复习 | 仅复习符合门禁条件的目标；到期查询、主动复习、重新评分及下一日期 |
| LF02-09 | 复习结算 | 展示结果、补救项及下次计划；恢复未完成任务，不能提交即清空队列 |
| LF02-10 | 路径完成及恢复 | 达标结果可追溯；未掌握/受阻目标不能误报全部完成；跨会话复用学习状态 |

### 6.2 掌握策略（以官方当前规则为业务起点）

| 知识类型 | 掌握依据 | 拟议首期约束 |
| --- | --- | --- |
| Memory（记忆） | 事实、公式、术语的检索练习 | 近期加权正确率，默认阈值 0.9 |
| Procedure（程序） | 独立完成步骤或任务 | 近期加权正确率，默认阈值 0.9 |
| Concept（概念） | 解释、辨析、应用及理解证据 | 定性 Rubric；必须有真实学习者原文与依据 |
| Design（设计） | 方案、作品或综合应用 | 定性 Rubric；验收目标与证据类型对齐 |

官方 compute_mastery 使用最近五次有效评分权重 [0.5, 0.7, 0.85, 0.95, 1.0]，1 次上限 0.5、2 次上限 0.8；支持有界部分分。Learn Pace 拟沿用该默认规则，必须单独验证证据过滤、作废重算和独立性。诊断不能注入虚假正确记录。定性评估以结构化结果落库，不能仅由 Agent 设置 passed=true。自报掌握可作为显式用户覆盖（若保留），来源与系统评估分开，不伪造证据。

## 7. LF02 状态机与执行契约

### 7.1 不同状态维度

| 状态 | 推荐值 | 权威对象 |
| --- | --- | --- |
| Path Status | draft / active / completed / archived | LearningPath；全部有效目标满足门禁才能完成学习阶段 |
| Session Mode | outline / study / review | Session；只允许相应工具 |
| Objective Status | new / learning / mastered；另有 deferred 标记 | Learning Domain；推导，不让 Agent 随意设置 |
| Learning Stage | diagnostic / explain / feynman_check / practice / error_diagnosis / review / completed | 教学活动；非固定线性顺序 |
| Interaction | registered / awaiting_input / answered / graded / abandoned | Question Interaction；含未最终评分的澄清分支 |
| Turn Status | queued / running / completed / failed / cancelled / interrupted | Application Host；不等同于待答题生命周期 |

上述为产品语义，具体命名以实现契约为准。官方 LearningProgress、InteractionStatus、mode.py 提供参考。知识点的路由选择与先修约束、阶段、复习优先级需要单独测试，不能仅通过声明的顺序推导正确性。

### 7.2 单次教学/答题的数据时序

1. Host 按 Path ID、Mode 和 Revision 加载最新 Learning Snapshot，将当前目标、待答状态和允许工具注入 Agent；工具根据可信应用上下文获得 ID，而不是由模型任意填写。
2. Agent 生成题目，经题型、知识点、答案和来源校验后写入 Interaction（registered → awaiting_input）；保存公开题卡与事件，终止本轮。标准答案及 Rubric 不提前出现在公开题卡。
3. 用户点“提交答案”，携带 interaction_id、submission_id、原始答案；应用先落库为 answered。普通追问/质疑不触发此操作。
4. Assessment 读取固定题目和答案版本，规则评分或调用模型做定性判断；模型失败则保留待评分/待澄清，不产生通过证据。
5. 评分事务写入 Attempt、Evidence、Mastery State、Review State/Task、Domain Event 与新 Revision；成功后再发布 UI 回执。
6. Policy 判断：未达标 → 继续练习或补救；达标 → 解锁后续目标；暂无可学但仍有未达标目标 → 显示阻塞/延期，不返回 complete。

### 7.3 Review 的独立验证原则

复习开始先给检索任务，不自动展开完整答案；用户主动点击提示/查看知识卡片时记录 hints_used、source_exposure 和 independent=false（若相关线索泄露答案）。答完才展示复习要点、历史错因、解释及下一计划；需补救时不强行进入下一复习点。复习间隔由 Scheduler 根据真实结果和策略更新；策略版本与时间戳持久化。已完成路径仍可复习，重新评估不达标时按策略回到学习/补救状态。

## V0.2 原型及待冻结规则
D03 大纲草稿/预览/确认；D04 诊断/反馈/费曼检查；D05 定性评估、补救教学和独立复测；D05Q 定量门禁与异议；D06 复习队列/独立检索/反馈/结算；D07 路径恢复及完成；D11 证据、提示、跳过和异议。复习失败后撤销系统掌握或标记保持风险的策略仍待冻结，D06 仅演示回退 Study。ReviewTaskStatus（待复习、已处理、延期、取消）与其他状态分开。
