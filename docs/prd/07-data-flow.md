# 07 · 数据流与业务命令

> V0.2 拟议产品设计基线（2026-11-24）。源自 PRD V0.1 和 V0.2 闭环复评；非已实现功能或已通过工程验收。遇到 V0.1 原型与 V0.2 约束冲突，以 V0.2 为拟议修订基线。参见 [复评](../evaluation/learning-loop-review-v0.2.md) 与 [设计索引](../design/README.md)。

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

> **分阶段实施说明（决策 D3）**：快速推进期（M2-A）先按上述命令顺序落库跑通 LF01/LF02 主流程，**暂不启用 SQLite 事务控制、Revision CAS 与严格幂等**；主流程跑通后，在加固阶段（M2-B）于 Host/Repository 边界统一补齐原子事务、CAS 校验、幂等与崩溃恢复对账。

### 8.3 从 UI 到数据的统一追踪链

| 用户操作 | Command / 应用服务 | 权威写入 | UI 成功回执 |
|---|---|---|---|
| 提问 | SubmitMessage | Session, Message, Turn, Submission | MessageCommitted；历史恢复 |
| 选文 | CreateThread | Thread, Quote anchor, source version | 子会话 ID；返回原位置 |
| 转目标 | CreateLearningPath | Path, path sources, session binding | PathCreated；进入 Outline |
| 确认/修订 | CommitOutline / ReviseOutline | Module/Objective, dependencies, revision, event | OutlineCommitted；Study 准入 |
| 出题 | RegisterQuestion | Question version, Interaction, public card | QuestionPresented；本轮结束 |
| 提示/作答 | RecordHint/SubmitAnswer | Exposure, submission_id, 原答案, interaction status | AnswerRecorded；待评分 |
| 评分 | CommitAssessment | Attempt, Evidence, MasteryState, ReviewTask, Event, Revision（加固期同事务） | AssessmentCommitted；刷新全部投影 |
| 作废/复核 | VoidAssessment / Regrade | 证据有效性、重算结果及事件 | 修订回执；重算状态和任务 |
| 复习 | CompleteReview | 有效复习证据、任务结果、新计划 | ReviewCompleted / ReviewScheduled；显示结果 |
| 恢复 | RecoverApplication / RestoreBackup | 校验后的业务快照与恢复记录 | 原交互、已提交结果或明确失败态 |

### 8.4 业务契约与数据流约束

- **作用域与来源**：确定 path_id、objective_id、session_id、turn_id、interaction_id、question_id/question_version、submission_id、evidence_id 关系；所有写入由可信 Host 绑定身份、模式和路径，不由模型任意选择。LF01 的对话和辅助反馈只有明确关联且经过受信任评估才能进入 LF02；跨会话/重放保持来源。
- **状态分离**：PathStatus、SessionMode、ObjectiveStatus、TeachingStage、InteractionStatus、TurnStatus、ReviewTaskStatus 分开。定义允许转移、拒绝条件及失败回执。路径全部掌握才完成学习阶段；延期、循环、先修受阻不等于完成。复习不通过按已冻结策略失去系统掌握/进入补救或标记保持风险，不能混用掌握与保持两个指标。
- **评估合同**：四种知识类型的题型与 Rubric、部分分规则、独立性、题目版本、重复题、诊断的作用和无效题处理。定性必须记录原回答、关键标准、依据、判定模型/版本；模型判定不可直接修改状态。定量按默认近5次加权评分及1/2次上限；输入证据须有效且符合独立性政策。局部辅导、查看原解、资料提示要记录曝光，不能只靠 `hints_used` 按钮。
- **复习规则**：评估何时产生任务、失败如何回补救、什么时候重新入队、提前结束保留任务、下次复习时间、重排/时区及时间回拨的规则。需确定定量掌握与保持度的更新关系（V0.2 的失败回退只是明确选定策略的示例），锁定一组可复算测试样本。
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
