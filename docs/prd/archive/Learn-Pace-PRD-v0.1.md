# Learn Pace 产品需求文档

**版本：V0.1 · 方案评审稿｜日期：2026-11-24｜范围：P0 LF01 / LF02**

本地优先的个性化学习 Agent · Android 优先验证，兼顾 iOS

## 0. 执行摘要与评审结论

Learn Pace 的目标是让学习者在移动设备上独立完成自由问答、概念辅导、目标规划、掌握学习与间隔复习。客户端负责 Agent 调度、业务规则及学习数据持久化；模型可由用户配置云端或局域网 API。首期不要求独立部署 DeepTutor Python/FastAPI 服务，也不承诺离线模型推理。

**结论：当前原型覆盖了 LF02 的主要导航和学习活动，但没有完整覆盖 LF01，也没有覆盖从大纲确认到评估、状态更新、复习结算和异常恢复的全部关键状态。现阶段可作为产品设计基线，不可据此认定产品或教学闭环已经完成。**

| 评审维度 | 当前依据 | 结论 |
| --- | --- | --- |
| 产品范围 | learn-pace README，已确认 LF01/LF02 | 明确，需冻结首期边界 |
| 界面原型 | 12 张独立高保真图：入口 1、初中 5、高中 6 | 主路径可见；关键交互状态缺失 |
| LF01 | 原型仅有问答入口与工作台追问框；已有文字方案 | 缺独立问答、局部辅导、恢复效果图 |
| LF02 | 目标、列表、详情、Study、Review 有图 | 缺 Outline 确认、有效证据门禁、结算与恢复 |
| 数据和技术 | 官方源码可参考；Lite/Cherry 已评估 | 尚未实现或进行端到端验证 |

本文区分三种性质：**已确认** = 前序项目范围和业务基线；**拟议** = 本 PRD 给出的页面、规则、接口和验收方案；**待验证** = 依赖工程或产品测试的事项。图中人物、进度、任务及题目均为原型示例，不代表真实学习记录。原型与文字规则冲突时，以本 PRD 的业务约束为拟议修订基线，待评审后更新原型。

## 1. 产品目标与范围

### 1.1 目标用户与任务

| 用户 | 核心任务 | 产品价值 |
| --- | --- | --- |
| 中小学学习者 | 自主理解概念、掌握学科知识、复习薄弱点 | 分步辅导、可验证的进度 |
| 成人、自学与考证学习者 | 围绕主题、考试或技能建立学习计划 | 自主定义目标，持续掌握与复习 |
| 自由探索者 | 随时追问、理解与扩展知识 | 无须先创建课程即可学习 |

### 1.2 首期范围

- P0：单设备个人使用、模型配置、LF01 多轮问答与 Little Tutor、LF02 的 Outline / Study / Review、评估与证据、复习调度、进度与会话恢复、本地备份。
- P0 可用轻量学习场景标签（小学、初中、高中、考证/自学、自由）来调整默认内容与导师风格；自由模式可直接进入，不强迫填写教育阶段。若尚无课程资产，仅提供自定义目标，不展示虚构的预置课库。
- P1：按学段/学科/年级或考试类型提供可选课程包（含来源及版本），扩展学习资料解析、可替换 RAG 服务、更多模型与 iOS 适配验证。
- P2：课程和小游戏的分享/导入与市场、互动教学资源、跨设备同步等。未进入 P0，不将原型中这些能力的占位图标作为已承诺功能。

<!-- pagebreak -->
## 2. 信息架构与页面导航

### 2.1 学习入口与流程不是同一概念

学段入口是学习上下文（Curriculum Profile），用于限定或推荐学科、目标、术语与教学难度；LF01/LF02 才是实际的学习流程。初中与高中效果图是同一套 LF02 页面在不同内容域中的实例，不是两套业务系统。小学、考证与自由模式也应复用同一学习领域；年级不等于能力水平，真实能力以证据为准。

| 维度 | 可选值 | 数据与行为 |
| --- | --- | --- |
| 学习场景 | 小学、初中、高中、考证/自学、自由 | Curriculum Profile；独立于 Session 和 Path |
| LF01 | 自由问答、Little Tutor | 用户问题驱动；可选理解验证 |
| LF02 | Outline、Study、Review | 目标驱动；状态机与掌握门禁 |

### 2.2 页面清单与入口

**拟议导航：7 个主页面 + 1 个轻量场景入口（P00），共 8 个路由类型；4 个一级 Tab：学习首页、问答、路径、我的。** 前序文字方案为 3 个 Tab、设置由首页进入；现有 12 张图采用 4 个 Tab。为保持图文一致，本稿建议将 P07 合并到“我的/设置”作为第 4 个 Tab。P00 仅首次/主动切换时出现，正常启动恢复首页或未完成会话，不重复强制选择。若坚持 3 Tab，应统一移除原型“我的”入口而非两套导航并存。

| ID / 页面 | 进入方式 | 主要去向 | 优先级 |
| --- | --- | --- | --- |
| P00 场景选择 | 首次启动 / 我的切换 | P01 或 P02；已有路径可直接恢复 | P0 轻量；课程包 P1 |
| P01 学习首页 | 首页 Tab | P02 / P05 / P06 | P0 |
| P02 自由问答 | 问答 Tab / 首页快捷 | Little Tutor / P04 / 历史会话 | P0 |
| P03 学习路径列表 | 路径 Tab | P04 / P05 | P0 |
| P04 创建学习目标 | 路径新增 / 问答转目标 | P06 Outline | P0 |
| P05 路径详情 | 列表、首页、学习会话返回 | P06 三种模式 / 知识点证据抽屉 | P0 |
| P06 掌握学习工作台 | 路径详情、目标创建、继续学习 | Outline / Study / Review；返回 P05 | P0 |
| P07 我的 / 设置 | 我的 Tab | 模型配置、备份、偏好、场景切换 | P0 |

**导航约束：** 一级 Tab 不重建会话。P04/P06 可沉浸式隐藏 Tab；返回时保留输入草稿、题目 ID、滚动锚点及模式。Little Tutor、历史会话、题目详情、复习结果和模型选择作为子路由/弹层或组件状态，不新增独立一级入口。若小屏不适合浮层，可全屏展示并保留返回关系。首次模型未配置时进入设置，返回原业务操作；本地历史浏览不受影响。

<!-- pagebreak -->
## 3. 页面需求与交互（P00–P04）

页面以现有蓝白配色、卡片与统一导航为视觉参考。学习页减少装饰性大头图和重复栏，优先保证正文、公式、答题卡与输入区可见；各页面必须有空态、加载态、错误态及可恢复状态。

| ID | 页面内容 / 布局 | 行为与业务约束 | 原型对应 |
| --- | --- | --- | --- |
| P00 | 学段卡片、自由模式、最近学习 | 选中场景后一次确认；可稍后切换。历史路径跨场景可恢复，不删除旧数据；无依据不显示“推荐” | F01 |
| P01 | 当前场景、待复习/学习中/已掌握数量、继续学习、今日任务、自由问答 | 优先恢复待答/待评分任务；复习按真实到期队列汇总；任务完成由业务状态产生，不允许勾选即掌握 | F02/F07 |
| P02 | 顶部模型/历史/新建，中间消息、引用及工具事件，底部输入与停止 | 发送/追问/取消/重试、选中文本、引用或局部辅导；可创建学习目标；默认不强制考试 | 缺图 |
| P03 | 路径名称、状态、进度、待复习数量、搜索、筛选、新建 | 草稿/学习中/已完成/归档；复习是任务或会话模式，不替代路径状态；按筛选显示真实记录 | F03/F08 |
| P04 | 第一步：目标、背景/能力目标；第二步：可选资料与模型 | 允许无资料创建；生成大纲失败仍保留草稿；创建后直达 Outline，不直接标为已掌握 | F04/F09 |

### 3.1 关键交互细节

- P00 学段选择只是偏好，不限制学习者的真实能力范围；课程来源、学科、年级和教材版本属于后续课程包的结构化属性。未选场景仍能自由问答和创建路径。
- P01 数字来自本地查询：已掌握是知识点数量，学习中是路径数量，待复习是有效到期任务数量，标签明确计量单位。可按当前场景筛选或查看全部。
- P02 提交普通文字只进入问答；互动卡片点击必须产生结构化提交事件，不能把随意追问误当作答题。停止生成不撤销已经提交的工具副作用。
- P03/P04 学习目标与资料可修改，但路径 ID 不变；默认名称由目标派生并允许重命名。删除与归档区别明确，删除须二次确认。
- 资料首期支持文本、引用和必要的本地文件引用；只有具备已授权且可用的解析/模型能力时才读取附件。未解析或网络不可达时显示状态，不能宣称已学习该资料。

<!-- pagebreak -->
## 4. 页面需求与交互（P05–P07）

| ID | 布局与组件 | 行为与业务约束 | 原型对应 |
| --- | --- | --- | --- |
| P05 | 目标、真实进度、大纲、复习任务、学习者画像、最近会话 | 继续学习、编辑大纲、复习、证据详情；同一路径多个会话共享进度；自报掌握和系统评估须区分 | F05/F10 |
| P06 | 顶部路径/知识点/进度、模式切换、可折叠大纲、消息流、结构化题卡/反馈、追问输入 | 模式独立控制工具权限；题卡持久化后本轮结束；提交答案、提示、跳过、质疑、重试均有明确事件 | F06/F11/F12；大纲与结算缺图 |
| P07 | Provider、模型、连通性测试、学习偏好、数据导出/恢复、场景切换 | API Key 独立安全存储；测试模型工具能力；备份前后校验；未配置模型不阻止本地浏览 | 缺图 |

### 4.1 P06 三种模式

| 模式 | 核心页面状态 | 允许的操作 | 禁止/约束 |
| --- | --- | --- | --- |
| Outline | 大纲草稿、模块列表、预览差异、确认/修改 | 学习者与导师共同确定目标、知识点及依赖 | 禁止正式出题和计入掌握；确认后进入 Study |
| Study | 当前目标、诊断、讲解、练习、反馈与进度 | 学习、提问、结构化答题、评估、纠错、延期目标 | 不随意重建大纲；未达门槛不得宣称系统评估掌握 |
| Review | 到期列表、当前复习点、独立检索、提示、评分、下一次复习 | 复习已经通过掌握门禁/已明示掌握的知识点；可主动复习未到期项 | 不夹带新知识点的正式学习；不默认先泄露答案 |

### 4.2 必须补充的交互状态

| 状态 | 页面响应与动作 |
| --- | --- |
| 大纲待确认/改动预览 | 展示增删、先修关系和影响的学习证据；确认、取消、继续修改 |
| 待答题 / 待评分 | 展示同一题；提交去重；退出后恢复，禁止重复生成同一题 |
| 答对、部分正确、答错 | 给出依据、薄弱点与下一动作；显示掌握门槛是否达成 |
| 对题目有异议 | 保留原题、讨论、修正或作废；不强制提交答案 |
| 知识点达标 / 路径完成 | 展示掌握结果与证据、后续知识点或复习计划 |
| 复习结算 | 已复习数、需补救项、下一次复习；允许提前结束，未完成任务保留 |
| 模型失败/中断 | 明确失败阶段，保存已有数据；提供继续或重试，不伪造评分 |

<!-- pagebreak -->
## 5. LF01：自由问答与概念辅导

**目标：** 让学习者能够自由提出问题、理解概念、自主追问，并把有价值的内容转为后续学习目标。是否进行理解验证由学习者意愿和教学情境决定，不把自由对话强制转换为测验。

### 5.1 端到端流程

首页/问答 → 创建或恢复 Session → 输入问题与可选引用 → 保存用户消息及 Turn → 装配模型、教学策略和授权工具 → 解释/澄清/检索/分步引导 → 流式展示 → 保存结果 → 继续探索、局部辅导或结束。任意时刻退出，重新打开可读取已保存历史及未完成交互。

| 需求 ID | 功能 | 验收标准 |
| --- | --- | --- |
| LF01-01 | 会话创建、继续、历史查询 | 多轮会话恢复准确；切换模型有记录，不丢失已有消息 |
| LF01-02 | 概念辅导 | 支持直接解释、澄清、苏格拉底提问及分步提示；未取得来源时不编造引用 |
| LF01-03 | 授权工具 | 仅执行允许的工具；错误、取消及输出具有可观察状态 |
| LF01-04 | Little Tutor | 选择一段消息→创建关联子会话→追问→返回原位置；子会话可重新打开 |
| LF01-05 | 可选理解验证 | 产生题目/回答/反馈；普通聊天仅是会话记录，未绑定有效评估不得计入 LF02 掌握度 |
| LF01-06 | 转入掌握学习 | 用户确认学习目标，携带来源会话/消息/选文，创建 P04 草稿；不自动标记知识点已掌握 |
| LF01-07 | 恢复与重试 | 流式输出中断后保留已提交内容，显示状态；重试不重复已完成工具副作用 |

### 5.2 Little Tutor 与跨流程切换

Little Tutor 以消息为锚点建立子会话，至少保存 parent_session_id、source_message_id、selected_text、选文位置/版本和子会话 ID。只把允许的父会话上下文带入子会话；返回后不改变原主对话的流程状态。用户可选择把解释摘要引用回主会话。

LF01 → LF02：从对话或选文创建目标；保留来源并由用户确认大纲。LF02 → LF01：从当前知识点打开关联问答；原路径的待答题与当前模式不受影响。只有通过受信任的评估服务将证据精确关联至有效 Objective ID，才允许影响对应路径的学习状态；未验证关联仅作为学习记录。

### 5.3 数据输入、处理与输出

输入：Session ID、用户原文、模型配置、引用、附件、教学偏好。处理：Turn Coordinator 保存提交请求，Agent 调用外部模型及授权 Tools，应用层投影文本和结构化事件。输出：Message Parts、引用、交互卡片、工具结果及终态。权威数据为本地会话和提交记录，不依赖模型复述历史。LF01 完成条件是有效响应或明确失败终态与可恢复会话，不要求达到指定掌握度。

<!-- pagebreak -->
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

<!-- pagebreak -->
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

<!-- pagebreak -->
## 8. 技术架构、业务服务与数据流

### 8.1 客户端内运行架构（候选）

React Native / Expo UI → Local Application Host → Agent Runtime Adapter（候选 Pi Durable）→ 外部 LLM API。Agent Tools 通过应用端口访问 Learning Domain、Session、Source 等服务。Domain 通过 Repository 访问 SQLite；文件走 App Sandbox，密钥走 SecureStore。外部检索/素材解析为可选 Tools，不是 P0 强制业务后端。

| 层级 | 责任 | 关键边界 |
| --- | --- | --- |
| Presentation | 4 Tab、页面、流式消息、题卡、交互状态 | UI 仅提交命令与展示已提交投影 |
| Application | Session、Turn Coordinator、Learning Application、Recovery | 绑定当前 path/mode/session，权限、幂等、事务编排 |
| Agent Runtime | 模型接入、上下文、工具循环、取消、事件 | 不拥有掌握判定权；替换 Runtime 不改变领域契约 |
| Learning Domain | Path/Objective、Assessment、Evidence、Policy、Scheduler | 纯业务规则不依赖 Pi 或 RN；状态必须有证据和回执 |
| Infrastructure | SQLite、FileSystem、SecureStore、网络 | 本地权威数据、可替换外部能力 |

### 8.2 Command / Query / Event 契约

| 用户/Agent 行为 | Application Command | 写入及事件 |
| --- | --- | --- |
| 自由提问 | SubmitMessage | message、turn；TurnStarted / MessageCommitted |
| 创建目标 | CreateLearningPath | path、session；PathCreated |
| 确认/修订大纲 | CommitOutline / ReviseOutline | modules/objectives、revision；OutlineCommitted |
| 切换模式 | ChangeLearningMode | session mode；ModeChanged |
| 生成题目 | RegisterQuestion | interaction、question；QuestionPresented |
| 提交作答 | SubmitAnswer | interaction、原始答案；AnswerRecorded |
| 评分 | CommitAssessment | attempt、evidence、mastery、review；AssessmentCommitted |
| 作废题目 | VoidAssessment | 标记原证据失效、重算；AssessmentVoided |
| 完成复习 | CompleteReview（评估事务内） | review state/task；ReviewScheduled / ReviewCompleted |

UI 查询 HomeSnapshot、PathSummary、ObjectiveReport、SessionHistory、ReviewQueue、PendingInteraction。领域事件提交后刷新对应投影；流式 token 属临时呈现，最终消息、工具回执和需要恢复的交互必须落库。事件只作查询、审计与恢复，不必首期采用完整 Event Sourcing。

### 8.3 上游复用策略

- DeepTutor 官方：提取 LF01/LF02 业务语义、学习模型、模式准入、题卡/证据/调度及测试；不照搬整个 Python/Web 后端。
- DeepTutor Lite：参考 Pi Harness、Skills、Tools、会话恢复，不能直接继承其不完整的掌握门禁和复习逻辑，也不把 Node/Ink 代码直接装入 RN。
- Cherry Studio Mobile：参考 Pi Durable、原生适配、SQLite、事件投影、Expo/Metro/EAS；验证许可证及依赖兼容性。最终 Runtime 选型以移动端 PoC 为门槛，而非预先承诺。

<!-- pagebreak -->
## 9. 本地持久化与数据模型

### 9.1 权威存储和生命周期

**建议业务数据库为 learn-pace.db，运行时可另设 agent-runtime.db。** 业务数据是长期学习资产；Runtime 的工作副本、任务及检查点仅用于恢复执行。两者不得成为竞争的事实来源。首期可以采用聚合状态 JSON + 独立证据/交互表减少物理表数；以下是逻辑模型，不要求所有逻辑实体一一建表。若规范化，聚合状态是查询投影而非第二份独立权威数据。

| 领域 | 逻辑表/实体 | 关键字段或关系 |
| --- | --- | --- |
| 学习者与配置 | learner_profiles、curriculum_profiles、settings | learner_id、scope、偏好/来源、场景标签；场景不等同能力 |
| 模型 | providers、models | provider_id、base_url、model_id、capabilities、credential_ref |
| 会话 | sessions、messages、message_parts、session_threads | session_id、type、path_id(可空)、mode、parent_message_id、source_message_id、选文 |
| Agent 执行 | turns、turn_submissions、tool_calls、turn_events | turn_id、submission_id、seq、status、request_digest、error、receipt |
| 学习目标 | learning_paths、learning_modules、objectives、objective_dependencies、path_sources | path_id、goal、revision、module_id、objective_id、type、依赖、来源哈希 |
| 评估 | questions、interactions、assessment_attempts、learning_evidence、error_records | question/version、interaction/status、attempt/answer、evidence/source、validity、hints、independent |
| 掌握与复习 | mastery_states、review_states、review_tasks、review_strategies、learning_events | objective_id、score、gate、mastery_source、due_at、priority、strategy_version、revision |
| 资料 | attachments、files | file_id、相对路径、mime、hash、可用/解析状态 |

关系：Learner 1:N Path/Session；Path 1:N Module，Module 1:N Objective；Objective 1:N Question/Evidence/ReviewTask；Path 1:N Session；Session 1:N Message/Turn/子会话；Question 1:N Attempt，Attempt 可产生有效或作废 Evidence；每个路径内 Objective 的 MasteryState 与 ReviewState 各最多一份当前投影。独立问答 Session 的 path_id 可空；结构化证据关联必须校验路径及知识点身份。

### 9.2 首期物理存储建议

以官方 aggregate + transactional store 为参考，最小表族包含 sessions/messages、turns/submissions/events、paths（state_json + revision）、interactions（状态与题目快照）、attempts/evidence（权威或明确投影）、domain_events、settings/providers/files。掌握状态及复习任务可先由 path 聚合维护，必要时增加索引查询投影。避免 session.path_id 与路径成员表同时成为独立写入权威。表结构最终由技术方案及迁移脚本确认。

### 9.3 App Sandbox 与备份

业务 SQLite 使用 WAL、外键、Schema migration；用户文件以相对路径及哈希记录；缓存可重建。API Key 不写普通 JSON、消息、模型日志或明文备份，使用 SecureStore（安全存储与平台备份策略需验证）。导出一致性数据库快照、manifest（schema/app 版本、校验值）、资料与配置；备份/恢复应验证完整性，失败保持旧数据。默认不包含凭据与不必要运行时工作副本。删除/归档/导出必须明确用户控制。

<!-- pagebreak -->
## 10. 数据一致性、恢复与非功能需求

| ID | 要求 | 验收条件 |
| --- | --- | --- |
| NFR-01 | 本地独立运行 | 除用户选用外部模型/工具，无必需独立业务服务；断网可浏览历史、路径和待复习列表 |
| NFR-02 | 事务性 | 评分、证据、掌握状态、复习计划和领域事件原子提交；失败不留下半更新状态 |
| NFR-03 | 幂等性 | submission_id 唯一；同一交互的相同作答重试返回已有结果；过期题卡/Revision 受控拒绝 |
| NFR-04 | 可恢复 | 出题后终止进程、已提交未评分、评分已提交未刷新，都能恢复相应状态 |
| NFR-05 | 可追溯与可重算 | 每条有效证据关联原答案、题目版本、目标、评估方式和时间；作废题可重算 |
| NFR-06 | 权限及安全 | 模式工具 allowlist、路径绑定、授权来源；禁止任意本地代码/文件执行，外部内容不能覆盖系统权限 |
| NFR-07 | 数据隐私 | 用户可查看、删除、导出；外部模型调用明确告知数据流向；未成年人场景上线前单独评估隐私及保护要求 |
| NFR-08 | 移动可用性 | 小屏/键盘/安全区、文字缩放、公式显示、触控反馈与取消；输入草稿及页面返回可恢复 |
| NFR-09 | 性能与兼容性 | Android ARM64 安装、启动和连续学习实测；不以装饰图占用主要阅读区；确定设备及数据量后设置可量化性能门槛 |
| NFR-10 | 可维护 | 业务 Domain 不绑定 UI/Runtime，官方业务契约迁移测试；上游版本固定、依赖许可证审查 |

### 10.1 异常恢复矩阵

| 异常或中断 | 持久化状态 | 恢复动作 |
| --- | --- | --- |
| 问答生成时退出 | 用户消息、Turn、已持久化消息片段 | 显示 interrupted；允许重试或继续 |
| 题目已生成未作答 | awaiting_input、题目 ID/版本 | 恢复同一题卡，不重新出题 |
| 作答已提交未评分 | answered、原始答案 | 继续评分或请求澄清，不丢答题 |
| 评分提交后 UI 崩溃 | graded、证据、Revision、复习计划 | 重读投影，不重复更新 |
| 旧题卡、重复点击 | submission_id、interaction/version | 去重或拒绝过期提交并刷新 |
| 大纲修订失败 | 原版本、预览变更 | 取消/重新预览；保留原证据 |
| 复习提前结束 | 未处理任务 | 保持到期状态，下次继续 |

外部模型调用不持有长期 DB 写锁；答案先提交，模型评估完成后进行短事务和 CAS 校验。单路径同时最多一个有效待答交互及一个修改型 Turn；自由问答与路径学习可独立运行，但共享资源需有明确并发限制。

<!-- pagebreak -->
## 11. 原型交叉校验（12 张图）

图号对应附录，按同一页面类型比较两种学段。判定的是 UI 表达能力，不是代码测试通过率。第一组原型演示初中场景，第二组演示高中场景，均主要覆盖 LF02。

| 图号 | 页面/状态 | 已覆盖 | 必须修订或补充 |
| --- | --- | --- | --- |
| F01 | P00 场景选择 | 5 种场景、继续学习 | 场景与流程分离；推荐需依据；选中与进入动作统一 |
| F02/F07 | P01 初中/高中首页 | 统计、继续学习、任务、问答入口 | 区分计量单位、真实任务状态；真题仅来自授权资料 |
| F03/F08 | P03 路径列表 | 搜索、筛选、进度、新建 | 学习中筛选却显示“新建”；新建状态与非零进度冲突 |
| F04/F09 | P04 创建目标 | 目标、背景、资料、模型 | 两步标记与同屏资料冲突；补第二步或取消步进标记；导师角色与实际模型分离 |
| F05/F10 | P05 路径详情 | 进度、大纲、复习、画像、历史 | 统一进度计算、当前知识点及证据详情；明确画像来自何处 |
| F06/F11 | P06 Study | 模式、讲解、图示、选择题、追问 | 缺诊断/费曼检查/错因/评分/达标状态；题目与目标要一致 |
| F12 | P06 Review | 复习数量、历史错因、练习、记录入口 | 答前直接揭示规则污染独立测评；缺评分、重新调度、结算与退出恢复 |
| 无 | P02 / Little Tutor / P07 / Outline 等 | 前序文字设计已有 | 需要补效果图及可点击交互原型 |

### 11.1 数值、内容与业务一致性

- 初中同一路径显示 40%（8/20）和 Study 42%；高中列表/Study/Review 48%、详情 46%、已掌握 9/20 实际为 45%。若“学习进度”采用已掌握数/总目标数，必须统一为对应数值；如采用其他指标，独立命名并说明公式。高中模块 4/5=80%、3/8≈38%、2/7≈29%，原图的 78%、42%、25% 不符。
- 高中详情高亮“函数的奇偶性”，工作台显示“导数的几何意义”；Review 将“函数单调性”挂在“导数概念”，而详情列在“函数基础”。由统一 Objective ID 与 Policy 选出当前点，若显式切换/延期需记录，不能由不同页面各自推断。
- 初中 Study 写“k=0”是一次函数图像性质；按初中通常定义 y=kx+b 中 k≠0，k=0 是常值函数，应修正。高中导数几何意义配的是 y=x² 在 x=1 处求导题，主要检验计算程序，不足以单独证明几何意义概念掌握；应增加解释切线斜率的独立题或定性任务。
- Review 图在出题前完整提示导数符号判定规则，并直接声明做完即下一个点；应改为先独立检索、按需展开提示、按评分决定补救/继续与日期。已看答案或提示的作答记录为辅助证据。学习笔记、图像查看器、知识卡片入口若未实现，不应渲染为可用功能。

<!-- pagebreak -->
## 12. 闭环验收与简短实施规划

### 12.1 整体学习闭环判定

| 闭环 | 通过条件 | 当前原型/工程判断 |
| --- | --- | --- |
| LF01 会话 | 问题→解释/追问→保存→恢复；局部辅导及可选转路径 | 缺核心效果图；无实现验证 |
| LF02 教学 | 目标→确认大纲→诊断/教学→练习→反馈→达标或补救 | 主导航可见；大纲、反馈与门禁状态缺失 |
| LF02 复习 | 到期→独立检索→评估→调度→下次恢复 | 有 Review 图；缺结算及可验证调度 |
| 数据 | 答题/证据/进度/复习跨页面一致且重启恢复 | 数值示例冲突；需事务与端测 |

### 12.2 P0 最小端到端验收集

| 用例 | 给定 / 操作 | 必须观察到的结果 |
| --- | --- | --- |
| AC-01 LF01 | 配置外部模型；新建问答，追问并退出重启 | 原消息、模型及会话恢复；无额外服务依赖 |
| AC-02 Little Tutor | 选择消息片段并追问；关闭再打开 | 来源与子会话正确，主会话保持不变 |
| AC-03 Handoff | 从 LF01 创建目标；修改并确认大纲 | 来源保留、Path ID 稳定、Study 才开放 |
| AC-04 Mastery Gate | 独立答对三次，分别观察门槛；再测试错答/定性评估 | 分数按政策更新；无证据不达标；不强制所有类型同一流程 |
| AC-05 修复与恢复 | 题卡/作答/评分三个时点杀进程；重复提交/作废题目 | 不重复计分、正确重算、恢复原题或评分 |
| AC-06 Review | 推进测试时钟使任务到期；正确、错误、使用提示各测一次 | 独立性标记正确；任务及下次日期更新；补救分支可进入 |
| AC-07 一致性 | 检查首页、列表、详情、工作台；修改大纲；导出/恢复 | 相同 Revision 下数据一致，证据关联不丢失，备份可恢复 |
| AC-08 原生端 | Android ARM64 真机安装，无 Python 后端，完整执行 AC-01–07 | 可独立执行和重启恢复；iOS 按目标平台再验收 |

### 12.3 简短路线（按 Gate，不预估虚假工期）

| 阶段 | 主要交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| M0 基线冻结 | PRD 评审、补齐 LF01/Outline/评分/复习结算原型；明确 Tab/场景范围 | 页面、动作、状态、证据与验收用例逐项映射 |
| M1 技术验证 | Expo + Pi Durable 候选 Runtime + SQLite；Android APK、外部模型、结构化题卡与恢复 | 真机完成最小问答→出题→落库→重启恢复；确认许可 |
| M2 双流程实现 | LF01、LF02、领域服务与七主页面；本地备份 | AC-01–07 自动化/人工场景通过，无 P0 状态缺陷 |
| M3 MVP 交付 | Android 发布包、异常测试、设备与隐私验证；iOS 视验证结果 | AC-08 通过；按数据反馈决定课程包、市场等扩展 |

**发布判定：** M0 可进入技术验证；只有 M2/M3 的端到端用例通过，才可宣称两条学习流程完整闭环。现有原型本身不能作为上线验收证据。

<!-- pagebreak -->
## 13. 缺失原型清单与设计决策

以下是下一轮设计任务。它们是现有页面的缺失状态或弹层，除 P02、P07 外不要求新增主页面。

| 原型任务 | 对应需求 | 最小展示内容 | 优先级 |
| --- | --- | --- | --- |
| D01 自由问答 | LF01-01/02/03 | 首次提问、流式解释、历史与追问、模型选择 | P0 |
| D02 Little Tutor + 转目标 | LF01-04/06 | 选文菜单、子会话、返回锚点、创建目标确认 | P0 |
| D03 Outline | LF02-01/02 | 草稿、大纲模块/先修、变更预览、确认开始 | P0 |
| D04 诊断/费曼检查 | LF02-03/04/06 | 诊断结果、定性任务、提示状态 | P0 |
| D05 题卡反馈/补救 | LF02-05/06/07 | 正误/部分正确、证据与门槛、重试/异议 | P0 |
| D06 复习前后态 | LF02-08/09 | 先检索后反馈、复习结果、下次日期、补救 | P0 |
| D07 恢复/完成 | LF02-10/NFR-04 | 待答/待评分、路径完成、继续复习 | P0 |
| D08 我的/设置 | NFR-01/07 | 模型、连接测试、导出/恢复、场景切换 | P0 |

待评审决定：采用 4 Tab 还是延续 3 Tab；首期场景标签是否展示为首次引导；是否保留带来源标记的自报掌握；首期附件支持范围；Pi Durable Native 适配可行性和许可证边界。未验证的图像生成、笔记与课程内容不作 P0 必交付依赖。

## 14. 参考来源与版本

业务基线为 Learn Pace README 已确认的 LF01/LF02 范围（提交 5984492a9300b7069ad17f4c027e2994087a2ef4）。下列源码链接固定至本次前序审查的上游引用，不声称已重新运行测试。

- [Learn Pace README](https://github.com/kms9/learn-pace/blob/5984492a9300b7069ad17f4c027e2994087a2ef4/README.md)
- [DeepTutor ChatWorkspace](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/features/chat/components/ChatWorkspace.tsx) · [Little Tutor threads](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/lib/session-threads.ts)
- [DeepTutor MasteryStudy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/components/space/learning/MasteryStudy.tsx) · [Mastery 模式](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/capabilities/mastery/mode.py) · [Learning Domain / tests](https://github.com/HKUDS/DeepTutor/tree/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning)
- [Learning Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/storage.py) · [Session Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/services/session/sqlite_store.py) · [Mastery Policy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/policy.py)
- [DeepTutor Lite Harness](https://github.com/leonyvon/deeptutor-lite/blob/5082b93f9317b8ec8264f3261b86af2b8b280683/src/agent/harness.ts) · [Cherry Studio Mobile](https://github.com/CherryHQ/cherry-studio-app/tree/14a0224fcdce482a36298a364799c52bb98a8ae8)
- 视觉依据：本对话已有的 12 张 Learn Pace UI 原型（附录 F01–F12，原始 PNG 随 Markdown 资产包提供）。以上 PRD 是拟议产品基线，未修改 GitHub 仓库、未执行 App 测试。
