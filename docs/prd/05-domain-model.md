# 05 · 学习领域模型

> V0.2 拟议产品设计基线（2026-11-24）。源自 PRD V0.1 和 V0.2 闭环复评；非已实现功能或已通过工程验收。遇到 V0.1 原型与 V0.2 约束冲突，以 V0.2 为拟议修订基线。参见 [复评](../evaluation/learning-loop-review-v0.2.md) 与 [设计索引](../design/README.md)。

## 9. 本地持久化与数据模型

### 9.1 权威存储和生命周期

**建议业务数据库为 learn-pace.db，运行时可另设 agent-runtime.db。** 业务数据是长期学习资产；Runtime 的工作副本、任务及检查点仅用于恢复执行。两者不得成为竞争的事实来源。首期可以采用聚合状态 JSON + 独立证据/交互表减少物理表数；以下是逻辑模型，不要求所有逻辑实体一一建表。若规范化，聚合状态是查询投影而非第二份独立权威数据。

| 领域 | 逻辑表/实体 | 关键字段或关系 |
| --- | --- | --- |
| 学习者与配置 | learner_profiles、settings | learner_id、scope、偏好/来源；每条路径的学习档案（背景、目标程度、时间、先探查或先讲解）由导师维护 |
| 模型 | providers、models | provider_id、base_url、model_id、capabilities、credential_ref |
| 会话 | sessions、messages、message_parts、session_threads | session_id、type、path_id(可空)、mode、parent_message_id、source_message_id、选文 |
| Agent 执行 | turns、turn_submissions、tool_calls、turn_events | turn_id、submission_id、seq、status、request_digest、error、receipt |
| 学习目标 | learning_paths、learning_modules、objectives、objective_dependencies、path_sources | path_id、goal、revision、module_id、objective_id、type、依赖、来源哈希 |
| 评估 | questions、interactions、assessment_attempts、learning_evidence、error_records | question/version、interaction/status、attempt/answer、evidence/source、validity、hints、independent |
| 掌握与复习 | mastery_states、review_states、review_tasks、review_strategies、learning_events | objective_id、score、gate、mastery_source、due_at、priority、strategy_version、revision |
| 资料 | attachments、files | file_id、相对路径、mime、hash、可用/解析状态 |

关系：Learner 1:N Path/Session；Path 1:N Module，Module 1:N Objective；Objective 1:N Question/Evidence/ReviewTask；Path 1:N Session；Session 1:N Message/Turn/子会话；Question 1:N Attempt，Attempt 可产生有效或作废 Evidence；每个路径内 Objective 的 MasteryState 与 ReviewState 各最多一份当前投影。独立问答 Session 的 path_id 可空；结构化证据关联必须校验路径及知识点身份。



## 数据关系约束
Session 与 LearningPath 生命周期独立，单个路径允许多个会话；会话模式（outline / study / review）可在会话中切换。小老师侧聊是带父会话与锚点消息的独立会话。稳定 Objective ID 不随排序改变，大纲修订按名称与类型保持 ID；大纲预览记录基线版本并在过期后失效。题目版本与原答、评估依据、评分器/策略版本绑定。学习者自报掌握（`learner_mastery_overrides`）与系统评估分开记录，不产生测评证据；作废证据保留审计。P0 不使用 `curriculum_profiles`（2026-11-25 移除学习场景）。详见 [LF02](04-lf02-mastery-flow.md)。
