# Proposal

## Why

手机碎片时间里，学习者在问答页聊懂一个概念后，经常只想顺手做 1–2 道快问快答检验自己是否真懂，而不是重度新建一条精通之路。按 V0.4 范围决策表，将原 PRD LF01-05 明确为问答内「自测（考考我）」：由 Host 直接通过结构化 JSON 生成 1–2 道题，结果仅作为问答会话记录保存、绝不计入掌握度，答完后可继续聊或一键转为学习目标。

## What Changes

- **前置小验证（与 Change 10 并行）**：复用 S7 测试框架，以 DeepSeek Flash 在问答上下文中运行 10 次 JSON 直接出题基准，核验合法率（≥ 90%）、正文/题面答案零泄露（100%）与首字/响应延迟，不通过则先调整出题提示词或 Schema。
- **Host 直接出题与评分（`packages/runtime`、`packages/app-host`）**：
  - 不走导师工具循环（避免依赖强制首工具调用），在 `packages/runtime` 新增 `generateQuickCheck(config, request)`，基于最近有界问答历史通过 `response_format: json_object` 直接生成 1–2 道选择或简答题（经既有题卡结构校验与选项打乱）；
  - **独立数据存储（不复用 `interactions` 表）**：自测题目（含私有答案/解析）、学习者作答、评分结果与 `submission_id` 全部持久化在对应问答助手消息的 `messages.metadata.quick_check` 中，天然随本地备份导出恢复，且绝不污染 `interactions` 表、学习首页「该做的事」与精通恢复对账；
  - **评分与幂等**：复用选择题精确比对与 `assessSemantically` 语义判定；沿用 `submission_id` 幂等提交规则，重复提交同一作答不重复评分；严禁触碰 `learning_progress` 与复习计划。
- **问答自测 UI（`apps/mobile`）**：
  - 复用 `QuestionCard` 的内部选项/作答/批改展示子部件组合出独立的 `QuickCheckCard`（不给 `QuestionCard` 加复杂布尔开关）；
  - 提供两个入口：已完成助手回复底部的「考考我」次要操作，以及问答输入框旁的快捷入口；
  - 判完分后提供「继续聊」（把自测结果作为轻上下文回到对话框）与「转为学习目标」（复用既有新建向导并预选本轮话题与错题/自测摘录）。

### Non-Goals / Out of Scope
- **不计入精通之路掌握度或复习调度**：自测结果绝不写入 `learning_progress`、`learning_evidence`、`error_records` 或 `repetition_states`。
- **不写入 `interactions` 表**：避免把探索期自测混入精通之路待答题卡。
- **不做多轮澄清访谈（DeepTutor `ask_user` 工具流）**：V0.4 聚焦「考考我」理解检验，减少工具调用不确定性。

## Capabilities

### New Capabilities
- `chat-quick-check`: 定义问答内的自测能力（LF01-05）：Host 直接 JSON 出题、消息 `metadata` 持久化与强杀恢复、`submission_id` 幂等评分、与精通掌握度严格隔离以及「继续聊 / 转为学习目标」后续流转（对应 V0.4 AC-10）。

### Modified Capabilities
（无；自测仅扩展问答消息的 `metadata` 载荷，不修改既有 `lf01-chat` 核心需求或 `interactions` 契约。）

## Impact

- **受影响包**：`packages/runtime`（`generateQuickCheck` JSON 出题与校验）、`packages/app-host`（`Lf01ChatService` 自测生成与提交评分方法、零掌握度副作用测试）、`apps/mobile`（拆分 `QuestionCard` 共享展示部件并组合 `QuickCheckCard`，接入 `ChatConversation`）、`scripts/s8-quick-check/`（前置小验证脚本）。
- **依赖影响**：零新原生依赖，不增加 APK 原生体积。
- **前置依赖**：前置小验证达到阈值（可与 Change 10 并行执行）。
