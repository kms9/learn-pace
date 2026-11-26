# Proposal

## Why

按 V0.4 范围决策表，我们不搬运 DeepTutor 桌面端的重型块编辑器，而是局部放开手机端最高频的两项资产沉淀能力：**只读错题回看（3a）** 与 **轻量知识卡（3b）**——让学习者能一站式回顾做错的题目并直达原知识点重练，也能一键把好讲解、题卡解析收藏为可检索的知识卡，甚至在新建精通目标时把知识卡当作 `text_note` 资料复用，闭环整个学习沉淀链路。同时在本 Change 收口阶段 4 全链路整合、系统中文输入法语音实测以及相对 M3 基线的体积与冷启动对比。

## What Changes

- **3a · 只读错题回看（不建新表，复用现有数据）**：
  - 在 `InteractionStore` 新增只读查询 `listGradedInteractions()`；
  - 精通错题以当前 `learning_progress.learning_evidence`（未作废、非 `correct`）与 `interactions` 按 `evidence_id` 关联交集为权威来源（杜绝重置进度后的幽灵错题，保证错题数与路径页证据 100% 一致）；问答自测（Change 11）答错的题也可合并展示并显式标注「未计入掌握」；
  - 错因展示直接复用现有评分 `feedback`、`explanation` 与 `reference_answer`（不新增模型错因字段，不另造第二套错题复习调度）；
  - 在学习首页与路径页提供「错题回看」入口，每条精通错题提供「去练这个知识点」按钮，打开对应路径的学习或复习会话并在开场消息带上该知识点。
- **3b · 轻量知识卡（SQLite v6 + 8 表备份与 v5 兼容恢复）**：
  - 数据库升级至 SQLite v6（事务化 `migrateV6`，沿用故障注入回滚验证），新增 `knowledge_cards` 表（记录 `card_id`、来源类型与锚点、标题、正文、备注、可选 `path_id`、软删除 `deleted_at` 与时间戳）；删除精通路径时将关联知识卡的 `path_id` 置空保留，不销毁用户手工收藏；
  - 备份快照从 7 张表扩展至 8 张（`schema_version = 6`，`manifest.counts` 增加 `knowledge_cards`），并保证 **v5 旧版备份仍可无损恢复**（自动补齐空 `knowledge_cards`）；
  - 收藏入口：在问答/小老师选文确认层（复用于长按/选文）新增「收藏为知识卡」；在已判分题卡新增「收藏解析」；
  - 知识卡列表页（从学习首页进入）支持关键词搜索、编辑备注、软删除；新建精通目标向导第二步支持直接选择知识卡并作为既有 `text_note` 资料加入（不新增资料种类，不触碰冻结中的多源资料）。
- **语音输入与阶段 4 整合验收**：不自研语音模块，在真机问答输入框与简答题输入框实测中文输入法（讯飞/搜狗等）语音输入；完成「收到提醒 → 进入复习 → 答错 → 进错题 → 收藏为知识卡 → 用知识卡新建路径」全链路、v6/v5 备份往返及相对 M3 基线的安装包体积与冷启动对比。

### Non-Goals / Out of Scope
- **不做重型笔记编辑器**：无块编辑器、双向链接、Markdown 源码编辑或 AI 改写建议（`note_suggest`）。
- **不另建独立错题复习调度器**：复习答错回落与再调度继续完全由既有 FSRS 调度器负责。
- **不自研语音识别、不解冻多源资料（PDF/图片/网页）**。

## Capabilities

### New Capabilities
- `mistake-review`: 定义只读错题回看投影（精通错题与路径证据严格一致、自测错题标注未计入掌握、去练这个知识点直达会话）（对应 V0.4 AC-11）。
- `knowledge-cards`: 定义轻量知识卡的收藏、备注编辑、关键词搜索、软删除、路径删除解绑保护以及在新建向导中作为 `text_note` 资料复用（对应 V0.4 AC-11）。

### Modified Capabilities
- `local-storage`: 升级至 SQLite v6 新增 `knowledge_cards` 表（带事务回滚迁移），并补充 `listGradedInteractions()` 与 `KnowledgeCardStore` 契约。
- `local-backup-restore`: 备份快照扩展为 8 张表（`schema_version = 6`，含 `knowledge_cards` 计数），并保持对 v5 旧版备份的向后兼容恢复。

## Impact

- **受影响包**：`packages/infra`（SQLite v6 迁移、`listGradedInteractions`、`KnowledgeCardStore`、8 表快照与 v5 兼容归一化）、`packages/app-host`（只读错题投影 `MistakeReviewService`、`KnowledgeCardService`、`BackupRestoreService` 升级、删除路径解绑知识卡）、`apps/mobile`（错题回看页、知识卡列表/收藏入口、新建向导知识卡选用，遵循 `m2a-mobile-ux-polish` 视觉规范）。
- **依赖影响**：零新原生依赖。
- **前置依赖**：建议在 Change 10（`m2c-review-reminders`）归档后实施，避免与 `settings` 与备份链路同时冲突；若需合并展示自测错题，兼容 Change 11 的消息 `metadata.quick_check` 格式。
