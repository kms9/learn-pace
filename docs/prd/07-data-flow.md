# 07 · 数据流与业务命令

> V0.3 拟议基线（2026-11-25）：LF02 由导师在精通会话中调用工具推进（见 [06 §8.4](06-agent-runtime-contract.md)），用户界面直接发出的命令只剩创建、提交、切换模式、自报掌握等少数几项。参见[复刻方案](../evaluation/deeptutor-mobile-parity-plan-v0.3.md)。

### 8.2 Command / Query / Event 契约

| 行为 | 发起方 | Command / 工具 | 写入及事件 |
| --- | --- | --- | --- |
| 提问 / 追问 | 用户 | SubmitMessage | message、turn；TurnStarted / MessageCommitted |
| 问 Dito | 用户 | CreateThread | 侧聊会话、锚点、选文；ThreadCreated |
| 新建精通目标 | 用户（向导） | CreateLearningPath | 空路径、资料、编辑大纲模式会话；PathCreated |
| 建出 / 修订大纲 | 导师 | `mastery_build` / `mastery_revise`（预览 → 提交） | modules/objectives、version；OutlineCommitted |
| 切换模式 | 用户或导师 | ChangeLearningMode / `mastery_mode` | session mode；ModeChanged |
| 记录学习档案 / 讲解覆盖 | 导师 | `mastery_profile` / `mastery_note_explained` | learner_profile、explained_objectives |
| 出题 | 导师 | `mastery_quiz` | interaction、question；QuestionPresented（本轮结束） |
| 提交作答 | 用户（题卡）| SubmitAnswer | 原始答案、answered；AnswerRecorded |
| 批改 | Host（回合开始）或导师 | 引擎批改 / `mastery_grade` / `mastery_assess` | attempt、evidence、error、mastery、review；AssessmentCommitted |
| 跳过 / 延期 / 报错 | 用户或导师 | SkipQuestion / `mastery_defer_objective` / `mastery_repair_question` | 题卡状态、延期标记、作废与重算；AssessmentVoided |
| 自报掌握 / 撤销 | 用户（证据抽屉） | SetLearnerMasteryOverride | learner_mastery_overrides；MasteryOverridden / OverrideCleared |
| 复习策略与记忆保持目标 | 用户（复习计划） | SetReviewStrategy | review_strategy、desired_retention、重排复习计划 |

UI 查询 LearningHome、TopicAtlas、PathSummary、ObjectiveReport、SessionHistory、ReviewPlan、PendingInteraction。领域事件提交后刷新对应投影；流式 token 属临时呈现，最终消息、工具回执和需要恢复的交互必须落库。事件只作查询、审计与恢复，不必首期采用完整 Event Sourcing。

> **分阶段实施说明（决策 D3）**：快速推进期（M2-A）先按上述命令顺序落库跑通 LF01/LF02 主流程，**暂不启用 SQLite 事务控制、Revision CAS 与严格幂等**；主流程跑通后，在加固阶段（M2-B）于 Host/Repository 边界统一补齐原子事务、CAS 校验、幂等与崩溃恢复对账。

### 8.3 从 UI 到数据的统一追踪链

| 用户操作 | Command / 应用服务 | 权威写入 | UI 成功回执 |
|---|---|---|---|
| 提问 | SubmitMessage | Session, Message, Turn, Submission | MessageCommitted；历史恢复 |
| 问 Dito | CreateThread | 侧聊会话, 锚点消息, 选文 | 侧聊打开；「小老师 ×N」 |
| 新建精通目标 | CreateLearningPath | Path, path sources, outline session | PathCreated；进入编辑大纲会话并发送开场消息 |
| 大纲协商 | `mastery_build` / `mastery_revise` | Module/Objective, dependencies, version, preview | OutlineCommitted；「大纲已就绪」 |
| 出题 | `mastery_quiz` | Question, Interaction, public card | QuestionPresented；本轮结束 |
| 作答 | SubmitAnswer | submission_id, 原答案, interaction status | AnswerRecorded；下一轮开始批改 |
| 评分 | 引擎批改 / `mastery_assess` | Attempt, Evidence, Error, MasteryState, ReviewState, Event（加固期同事务） | AssessmentCommitted；题卡显示结果、刷新投影 |
| 作废 / 复核 | `mastery_repair_question` | 证据有效性、重算结果及事件 | 修订回执；重算状态和复习计划 |
| 自报掌握 | SetLearnerMasteryOverride | Override, note | 「由你确认」；进度刷新 |
| 恢复 | RecoverApplication / RestoreBackup | 校验后的业务快照与恢复记录 | 原题卡、已提交结果或明确失败态 |

### 8.4 业务契约与数据流约束

- **作用域与来源**：确定 path_id、objective_id、session_id、turn_id、interaction_id、question_id/question_version、submission_id、evidence_id 关系；所有写入由可信 Host 绑定身份、模式和路径，不由模型任意选择。LF01 的对话和辅助反馈只有明确关联且经过受信任评估才能进入 LF02；跨会话/重放保持来源。
- **状态分离**：PathStatus、SessionMode、ObjectiveStatus、TeachingStage、InteractionStatus、TurnStatus、ReviewTaskStatus 分开。定义允许转移、拒绝条件及失败回执。路径全部掌握才完成学习阶段；延期、循环、先修受阻不等于完成。复习独立答错时掌握回落、回到学习补救，同时记录一次失误并缩短复习间隔（与 DeepTutor 一致）；掌握与保持分别由作答记录和复习状态表示。自报掌握单独记录来源，不改变测评证据。
- **评估合同**：四种知识类型的题型与 Rubric、部分分规则、独立性、题目版本、重复题、诊断的作用和无效题处理。定性必须记录学习者原话、关键标准、依据、判定模型/版本；模型给出的「通过」不被采信，状态只由引擎判定。语义判定不确定（未评分或置信度低于 0.8）时不定分、由导师澄清。定量按默认近5次加权评分及1/2次上限；输入证据须有效且符合独立性政策。资料页曝光与题目自带的辅助标记使作答记为辅助（与 DeepTutor 一致，题卡不设提示按钮）。
- **复习规则**：评估何时产生任务、失败如何回补救、什么时候重新入队、提前结束保留任务、下次复习时间、重排/时区及时间回拨的规则。定量掌握与保持度的更新关系已确定为 DeepTutor 的评分与调度规则（见 [04 §6.3](04-lf02-mastery-flow.md)），需锁定一组可复算测试样本。
- **一致性和恢复（加固期目标态）**：创建或修改大纲、题卡登记、作答提交、评分提交必须具有明确的权威存储及回执。主流程跑通后，在加固阶段补齐：答案先写入、外部模型评估在锁外、短事务检查 interaction/version 和 path_revision 后写 Attempt/Evidence/Mastery/Review/DomainEvent；同一 submission_id 相同请求幂等、不同请求拒绝；旧题卡/过期预览拒绝并刷新；每路径最多一个有效待答交互和修改型 Turn；Agent DB 不得覆盖应用业务 DB；恢复使用业务回执、事件与 Runtime checkpoint 对账；作废证据保留审计并重算。
- **安全与设备**：只允许授权 Tool 与资料，外部模型接收最小必要上下文；密钥独立保存。未成年人数据/隐私、模型输出、授权来源及第三方协议审查是公开交付前的门槛。

### 8.5 评分事务时序（加固阶段目标态）
~~~mermaid
sequenceDiagram
    participant UI
    participant Host
    participant Assessment
    participant Domain
    participant DB as SQLite
    UI->>Host: SubmitAnswer(interaction_id, submission_id)
    Host->>DB: 保存原始答案与 answered 状态
    DB-->>UI: AnswerRecorded
    Host->>Assessment: 固定题目版本评分（锁外）
    Assessment-->>Host: 结构化评估
    Host->>Domain: CommitAssessment
    Domain->>DB: CAS + Attempt/Evidence/Mastery/Review/Event 短事务
    DB-->>Host: AssessmentCommitted
    Host-->>UI: 刷新同 Revision 投影
~~~
