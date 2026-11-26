# Spec Delta

## Purpose

定义 Learn Pace 在 M2-B 加固阶段的冷启动全局对账（含题组逐小题对账）、异常恢复矩阵、Host 故障注入验证以及可控时钟与设备时间回拨边界保障（对应 NFR-04、AC-05、AC-06）。

## ADDED Requirements

### Requirement: Global startup reconciliation without network calls
On cold launch, the application SHALL reconcile all local sessions and interactions without network calls: settling leftover `generating` replies and unanswered user messages to `interrupted`; reconciling each non-closed card per sub-question against committed `learning_evidence` before resolving card status (`graded`, partially-graded `awaiting_input`, or retryable `answered`); and finally deduplicating multiple open cards per path by preferring cards with saved progress over blank cards.

#### Scenario: Reconciling interrupted turns across all sessions on launch
- **WHEN** 问答会话与精通会话各自遗留一条 `generating` 回复后进程被强杀并重启
- **THEN** 冷启动对账无需打开具体会话即把两条回复置为 `interrupted`，保留已落库文本片段，不自动发起网络请求

#### Scenario: Reconciling a partially-graded group card preserves awaiting_input
- **WHEN** 一张 3 小题题组卡已有第 1 小题证据写入 `learning_progress`，其余 2 小题尚未作答，随后应用重启
- **THEN** 对账先恢复第 1 小题的评分展示态，整卡保持 `awaiting_input` 等待作答剩余小题，不误标为 `graded` 也不丢失已批改结果

#### Scenario: Reconciling an already-committed grade whose card was still answered
- **WHEN** 题卡全部非作废小题的证据均已写入 `learning_progress`，但题卡仍停留在 `answered`
- **THEN** 冷启动对账在恢复各小题展示态后将整卡纠偏为 `graded`，不重复计分、不重复写入证据

#### Scenario: Keeping an ungraded saved answer retryable and protecting it from blank duplicates
- **WHEN** 同一路径残留一张已保存未评分答案的旧题卡（`answered`）和一张更新的空白题卡（`awaiting_input`）
- **THEN** 对账在逐小题对账完成后优先保留有已保存答案的题卡供手动重试批改，并将空白重复卡置为 `abandoned`

### Requirement: Deterministic recovery across question, answer, and grading cutpoints
The application host MUST recover cleanly without data corruption or double grading when failures occur immediately after question registration, after answer persistence before grading, after grading commit before UI refresh, or during outline revision or repair.

#### Scenario: Fault injected across all three AC-05 cutpoints
- **WHEN** Host 故障注入测试在「出题后」「保存答案后」「评分事务提交后」三个切点分别中断执行并重新打开应用状态
- **THEN** 三种切点分别恢复原待答题卡、保留原答案并可继续批改、以及重读已提交结果且不重复计分

#### Scenario: Restart invalidates in-memory outline preview safely
- **WHEN** 导师生成大纲修订预览后应用重启，随后尝试提交旧 `preview_id`
- **THEN** 系统拒绝旧预览并提示重新预览，原大纲、知识点 ID 与历史证据保持不变

### Requirement: Clock skew and review scheduling robustness
Spaced repetition scheduling and due-review projections SHALL remain free of `NaN`, negative intervals, or out-of-range probabilities across multi-day progression, timezone shifts, and backward device clock skew (`now < last_review_at`): read-only browsing during backward skew MUST leave stored review timestamps untouched without inflating due counts, and grading submitted during backward skew MUST clamp `moment = max(now, last_review_at)`.

#### Scenario: Read-only browsing during backward device clock skew
- **WHEN** 设备时间回拨至早于 `last_review_at` 两天，学习者仅浏览学习首页、精通之路与复习计划
- **THEN** 遗忘风险钳制在 `0`、不虚增到期数、磁盘上的 `next_review_at` / `last_review_at` / `lapse_count` 原样不变，时钟恢复后到期数自动还原

#### Scenario: Submitting a review grade during backward device clock skew
- **WHEN** 设备时间回拨两天期间，学习者分别提交一次答对与一次独立答错评分
- **THEN** 答对命中同会话分支（`review_count` 递增，`next_review_at`、`stability` 与 `lapse_count` 不变）；独立答错按 `max(now, last_review_at)` 计算缩短间隔并递增 `lapse_count`，不产生负间隔或 `NaN`

#### Scenario: Controllable clock multi-day review regression
- **WHEN** 使用可控时钟按多天跨度依次推进多个已掌握知识点的复习、失误回落、五连对补救与提前结束
- **THEN** 到期排序、稳定度变化、失误次数与跨页到期数全部与锁定样本完全一致
