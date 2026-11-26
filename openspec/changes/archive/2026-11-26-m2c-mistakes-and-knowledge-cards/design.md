# Design

## Context

参见 `proposal.md`、`docs/prd/00-product-scope.md`（V0.4 范围决策表）与 `docs/prd/08-local-persistence.md` §10.2。本 Change 分为相互解耦的两部分：3a 只读错题回看（复用现有 `learning_evidence` 与 `interactions`，不建新表）和 3b 轻量知识卡（SQLite v6 新增 `knowledge_cards` 表，并把 Change 9 备份从 7 表升至 8 表且兼容 v5 旧备份）。

## Goals / Non-Goals

**Goals:**
- 3a 错题数与路径页有效非正确证据 100% 严格一致，重置进度后绝不残留幽灵错题。
- 3b `knowledge_cards` 支持原子 v5→v6 迁移（含失败回滚）、软删除、全文关键词搜索、删除路径时保留解绑，以及在向导第二步作为标准 `text_note` 资料复用。
- v6 备份完整覆盖 8 张表，且无损向后兼容恢复 v5 旧备份。

**Non-Goals:**
- 不做重型富文本/块编辑器或独立错题调度器。
- 不新增 `TopicSource.kind`（知识卡进入向导即转为 `kind = "text_note"`，不触碰冻结的多源资料）。
- 不自研语音输入（验收时实测中文系统输入法语音即可）。

## Decisions

### 1. 3a 只读错题投影（`packages/infra` + `packages/app-host/src/mistakes.ts`）
- `InteractionStore` 新增只读方法 `listGradedInteractions(pathId?: string): Promise<StoredInteraction[]>`（SQLite 按 `status = 'graded' ORDER BY updated_at DESC, interaction_id DESC`，内存实现一致）。
- `MistakeReviewService.listMistakes(filter?: { pathId?: string; includeQuickChecks?: boolean })`：
  1. **精通错题（权威交集口径）**：遍历所有路径的 `learning_progress`，收集 `learning_evidence` 中满足 `assessment_type IN ('quiz', 'review')`、对应 `quiz_attempt` 未作废（`!voided`）且 `result !== 'correct'` 的有效证据，按 `evidence_id`（单题 `interaction_id`，题组 `${interaction_id}:${question_id}`）关联 `listGradedInteractions()` 中的题干、选项、原答案与 `QuestionGrade`（`feedback`、`explanation`、`reference_answer`）。
     - **优势**：`resetProgress` 会清空 `learning_evidence`，因此交集口径天然屏蔽重置后残留在 `interactions` 中的旧记录，严格保证「错题数 = 路径页有效非正确测评证据数」。
     - 每条精通错题标记当前所属知识点状态（学习中/已掌握），提供「去练这个知识点」动作：打开对应路径的新学习会话（若已掌握可打开复习会话）并自动发送带该知识点名称的开场消息。
  2. **问答自测错题（可选并列）**：遍历 `lf01` 会话消息中 `metadata.quick_check` 已定论且 `result !== 'correct'` 的小题，展示题干、你的作答、参考答案与解析，强制标注「未计入掌握」，点击可回到原问答会话。

### 2. 3b `knowledge_cards` 表与 SQLite v6 迁移（`packages/infra`）
- `schemaVersion` 由 `5` 升至 `6`，`migrateV6(db)` 整体包在 `BEGIN IMMEDIATE … COMMIT`（失败 `ROLLBACK` 并重抛）：
  ```sql
  CREATE TABLE IF NOT EXISTS knowledge_cards (
    card_id TEXT PRIMARY KEY NOT NULL,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('chat', 'little_tutor', 'mastery_card')),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    path_id TEXT,
    source_session_id TEXT,
    source_message_id TEXT,
    source_interaction_id TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    deleted_at REAL
  );
  CREATE INDEX IF NOT EXISTS knowledge_cards_active_by_update
    ON knowledge_cards (updated_at DESC, card_id)
    WHERE deleted_at IS NULL;
  PRAGMA user_version = 6;
  ```
- `KnowledgeCardStore`（内存与 Expo SQLite 实现一致）：
  - `saveKnowledgeCard(card)`、`getKnowledgeCard(id)`、`listKnowledgeCards(options?: { includeDeleted?: boolean; query?: string })`、`softDeleteKnowledgeCard(id, now)`、`detachKnowledgeCardsByPath(pathId, now)`。
- **删除路径保护**：`MasterySessionService.deleteTopic(pathId)` 在同一删除事务内调用 `tx.detachKnowledgeCardsByPath(pathId, now)`（仅将 `path_id` 置 `NULL`），保护用户手工收藏的知识卡不被连带删除。

### 3. 备份快照 7→8 表升级与 v5 向后兼容（`packages/infra` + `packages/app-host`）
- `DatabaseSnapshot` 新增 `knowledge_cards: StoredKnowledgeCard[]`（含软删除行以保证恢复前后完整一致）；`BackupManifest.counts` 新增 `knowledge_cards: number`（统计未软删除活跃卡片数）。
- `BackupRestoreService.inspectBackup` 与 `restoreBackup`：
  - 接受 `schema_version === 6` 与历史 `schema_version === 5`（`schema_version > 6` 仍拒绝）；
  - 当检测到 `schema_version === 5` 且 `payload.knowledge_cards === undefined` 时，校验通过（校验的是原始 `manifest` + `payload` 的 SHA-256）后，在写入前归一化为 `{ ...payload, knowledge_cards: [] }`；预览中显示知识卡数为 `0`。

### 4. 移动端入口与交互（`apps/mobile`）
- **错题回看页（`apps/mobile/app/learning/mistakes.tsx`）**：从「学习」首页（「错题回看 · N」）与路径页入口进入；支持按路径筛选、展示题目/你的作答/反馈与解析、「去练这个知识点」与「收藏解析」。
- **知识卡页（`apps/mobile/app/learning/cards.tsx`）**：从「学习」首页进入；顶部关键词搜索框（按标题、正文、备注过滤）、卡片详情编辑备注与二次确认软删除。
- **收藏入口**：
  - 问答与小老师选文确认层（及 Android 原生选区操作条）新增「收藏为知识卡」；
  - 已判分题卡（精通 `QuestionCard` 及自测 `QuickCheckCard`）新增「收藏解析」。
- **向导复用**：`apps/mobile/app/mastery/new.tsx` 第二步资料列表增加「从知识卡选择」区，选中后作为 `{ kind: "text_note", label: card.title, text: ... }` 传入 `createTopic`（与纯文本笔记走同一条 `TopicSource` 管道）。

## Risks / Trade-offs

- **[Risk] SQLite v5→v6 迁移中途出错可能损坏数据库** → Mitigation：`migrateV6` 包裹在 `BEGIN IMMEDIATE … COMMIT` 事务中，并沿用 M2-B 故障注入方式在 `migration-sql.test.ts` 验证失败后完整回滚至 v5。
- **[Risk] 历史 v5 备份在 v6 应用恢复时若校验逻辑硬要求 `knowledge_cards` 字段会误拒旧备份** → Mitigation：先按备份内原始 `manifest` + `payload` 计算 SHA-256，校验通过后再按 `schema_version === 5` 做归一化补齐空数组，并配专门单测验证。
