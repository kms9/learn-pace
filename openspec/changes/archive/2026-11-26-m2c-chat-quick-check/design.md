# Design

## Context

参见 `proposal.md`、`docs/prd/03-lf01-exploration-flow.md` LF01-05 与 `docs/prd/09-acceptance-criteria.md` AC-10。现有 `PiDurableRuntime` 不支持强制首工具调用，`interactions` 表的 `path_id` 为 `NOT NULL` 且被学习首页与 `RecoveryService` 视为精通之路待答题卡。本 Change 采用「Host 直接 JSON 出题 + 消息 `metadata` 持久化 + 复用既有评分与题卡子部件」的零侵入方案。

## Goals / Non-Goals

**Goals:**
- 用 10 次真实 DeepSeek Flash 前置小验证确认直接 JSON 出题的合法率、零答案泄露与延迟。
- 自测数据与精通之路彻底隔离（零修改 `learning_progress` 与 `interactions`），天然被 Change 9 备份恢复覆盖。
- 复用 `exactVerdict`、`assessSemantically` 与 `QuestionCard` 内部展示部件，避免代码复制或给 `QuestionCard` 塞模式布尔开关。

**Non-Goals:**
- 不走导师工具循环、不引入 `ask_user` 工具。
- 不修改 SQLite Schema、不写入 `interactions` 或 `domain_events`。
- 不在小老师侧聊中强制开启自测（聚焦问答主会话）。

## Decisions

### 1. 前置小验证（S8 自测出题基准）
- 复用 S7 基准脚本结构，在 `scripts/s8-quick-check/` 针对 10 组典型问答上下文（概念/程序/记忆/设计/公式）调用 `generateQuickCheck`：
  - **通过门槛**：① 10 次中 JSON 结构与题目合法率 ≥ 90%（≥ 9/10）；② 公开题干/选项与正文导语答案零泄露 100%（10/10）；③ 响应耗时 P50 ≤ 10 s、P90 ≤ 18 s。
  - 若未达标，优先优化 JSON prompt 与校验提示后再进入 UI 落地。

### 2. Host 直接 JSON 出题（`packages/runtime/src/quick-check.ts`）
- 新增 `generateQuickCheck(config, { history, focusExcerpt?, signal }, fetch?)`：
  - 复用 `streamSimple` + `response_format: { type: "json_object" }`（与 `semantic-assessment.ts` 同路径）；
  - 要求模型返回 `{ intro: string, questions: [{ question_type: "choice" | "short", question, options?, expected_answer, accepted_answers?, explanation }] }`（1–2 题）；
  - 经 `validateStudyQuestion` 同源校验器检查选项互异与答案匹配、随机打乱选项并标注 `A/B/C/D`，同时检查 `intro` 与题干未直接暴露答案。

### 3. 消息 `metadata` 持久化与幂等评分（`packages/app-host/src/lf01-chat.ts`）
- 在问答会话中写入一条助手消息（`role = "assistant"`, `status = "committed"`, `content = intro`），将完整自测载荷存入 `metadata.quick_check`：
  ```ts
  export interface StoredQuickCheck {
    check_id: string;
    source_message_id?: string;
    status: "awaiting_input" | "answered" | "graded";
    questions: PendingQuestion[]; // 1–2 题，含私有 expected_answer/explanation
    answers: Record<string, string>;
    submission_id: string | null;
    grades: Record<string, QuestionGrade>;
    grading_failed?: boolean;
    created_at: number;
    updated_at: number;
  }
  ```
- 对外投影（`publicQuickCheck`）：在 `status !== "graded"`（或某小题未定论）前剥离 `expected_answer`、`accepted_answers` 与 `explanation`，绝不向 UI 暴露未判分答案。
- **提交与幂等（`Lf01ChatService.submitQuickCheck(sessionId, messageId, answers, submissionId)`）**：
  - 受 `RestoreGate` 与同会话 `exclusively(sessionId)` 保护；
  - 若 `quick_check.submission_id === submissionId`：载荷一致且已定论直接返回既有结果（不重评），待评/失败则复用重试；载荷不同抛 `SubmissionConflictError`；已定论遇到新 `submissionId` 拒绝；
  - 先保存 `answers`、`submission_id` 与 `status = "answered"` 到该消息 `metadata`；
  - 在锁外逐题调用精确比对 / `assessSemantically`；判定完成后更新该消息 `metadata.quick_check`（`grades` 与 `status = "graded" | "awaiting_input"`），全程零读写 `learning_progress` 与 `interactions`。
- 判分后操作：
  - **「继续聊」**：将简短自测摘要预填或作为下一轮引用送入问答输入框；
  - **「转为学习目标」**：复用 `learningGoalSource`，携带 `sourceSessionId`、`sourceMessageId` 与自测题干/薄弱点摘录（≤600 码点）跳转 `mastery/new`。

### 4. UI 组件拆分与复用（`apps/mobile`）
- 从 `apps/mobile/src/components/mastery/QuestionCard.tsx` 抽出无业务耦合的内部子部件（选项列表、文本作答区、单题评分结果与解析展示），由 `QuestionCard` 与新增的 `QuickCheckCard.tsx` 各自组合，不给 `QuestionCard` 叠加 `mode="quickCheck"` 布尔分支。
- 在 `ChatConversation.tsx` 的助手消息底部弱化操作条中增加「考考我」，在 `ConversationComposer` 附近提供快捷「考考我」按钮（空会话无历史时禁用），并渲染挂在消息上的 `QuickCheckCard`。

## Risks / Trade-offs

- **[Risk] 私有答案存放在 `messages.metadata` 中，切勿直接将未脱敏的 `metadata` 透传到前端渲染或模型历史** → Mitigation：`boundedHistory` 只读取 `message.content`，不把 `metadata.quick_check` 发给模型；UI 只消费脱敏后的 `publicQuickCheck` 投影。
- **[Risk] 2 道简答题串行语义判定可能增加等待时间** → Mitigation：选择题走本地零延迟精确比对，简答题并行判定并在提交中禁用重复点击。
