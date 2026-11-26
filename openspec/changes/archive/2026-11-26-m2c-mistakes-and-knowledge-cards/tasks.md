# Tasks

> 前置：M2-B 全部归档，且建议在 Change 10（`m2c-review-reminders`）归档后实施 3b（避免同时改动 `settings` 与备份链路）；3a 只读错题回看可先行或同 Change 落地。

## 1. 3a Read-Only Mistake Review (`packages/infra`, `packages/app-host`)

- [x] 1.1 在 `packages/infra/src/{index,memory,expo}.ts` 为 `InteractionStore` 新增只读查询 `listGradedInteractions(pathId?)`，补充内存与 SQLite 一致性测试。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [x] 1.2 新增 `packages/app-host/src/mistakes.ts` 实现 `MistakeReviewService`：以 `learning_progress.learning_evidence`（未作废、非 `correct`）与 `listGradedInteractions()` 的交集投影精通错题（附 `feedback`、`explanation`、`reference_answer`），可选合并问答自测错题并标注「未计入掌握」，提供「去练这个知识点」会话启动参数。新增 `packages/app-host/src/__tests__/mistakes.test.ts` 覆盖错题数与路径证据严格一致、重置进度后幽灵错题清零、作废题不出现与自测错题标注。运行 `corepack pnpm --filter @learn-pace/app-host typecheck && corepack pnpm test`。

## 2. 3b SQLite v6 Migration, Knowledge Cards & v5/v6 Backup (`packages/infra`, `packages/app-host`)

- [x] 2.1 在 `packages/infra/src/migrations.ts` 新增事务化 `migrateV6`（`BEGIN IMMEDIATE … COMMIT` 创建 `knowledge_cards` 表与索引，失败完整回滚）；在 `packages/infra/src/{index,memory,expo}.ts` 实现 `KnowledgeCardStore`（`saveKnowledgeCard`、`getKnowledgeCard`、`listKnowledgeCards`、`softDeleteKnowledgeCard`、`detachKnowledgeCardsByPath`），并将 `DatabaseSnapshot` 扩展为 8 张表。在 `migration-sql.test.ts` 与 `memory-store.test.ts` 验证 v5→v6 升级、迁移故障注入完整回滚及 8 表快照读写。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [x] 2.2 新增 `packages/app-host/src/knowledge-cards.ts` 实现 `KnowledgeCardService`（从选文/解析创建卡片、搜索、编辑备注、软删除，均接入 `RestoreGate`）；更新 `MasterySessionService.deleteTopic` 在删除事务内调用 `detachKnowledgeCardsByPath` 保留卡片；更新 `packages/app-host/src/backup-restore.ts` 支持 `schema_version = 6`（8 表导出与预览计数）及 **v5 旧备份向后兼容恢复**（自动补齐空 `knowledge_cards`）。新增 `packages/app-host/src/__tests__/knowledge-cards.test.ts` 并扩充 `backup-restore.test.ts` 覆盖收藏、搜索、软删、删路径保留卡片、v6 往返与 v5 旧备份恢复。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Mobile Mistake Review, Knowledge Cards & Wizard Integration (`apps/mobile`)

- [x] 3.1 新增 `apps/mobile/app/learning/mistakes.tsx`（只读错题列表、按路径筛选、自测「未计入掌握」标签、「去练这个知识点」与「收藏解析」）并在学习首页与路径页接入入口；新增 `apps/mobile/app/learning/cards.tsx`（知识卡列表、关键词搜索、编辑备注、软删除）并在学习首页接入入口。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 3.2 在 `ChatConversation.tsx` 选文操作中新增「收藏为知识卡」、在已判分 `QuestionCard`（及 `QuickCheckCard`）新增「收藏解析」；更新 `apps/mobile/app/mastery/new.tsx` 第二步支持选择知识卡并作为 `text_note` 资料带入新建路径。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Android ARM64 Physical Device Verification & Stage 4 Integration (AC-11 & AC-12)

- [x] 4.1 在 Android 真机（`86ceabbf`）完成 **AC-11** 与 **阶段 4（AC-12）** 全链路整合验收：① 实测中文系统输入法（讯飞/搜狗等）在问答输入框与简答题输入框中的语音输入正常上屏无焦点问题；② 全链路走查「收到提醒 → 进入复习 → 答错 → 进错题回看（核对错题数与路径证据一致，重置路径无幽灵错题）→ 收藏为知识卡 → 搜索与编辑备注 → 用知识卡作为 `text_note` 新建路径并建出大纲」；③ 完成 v6 备份导出、清空本地、恢复往返（含知识卡与提醒设置）以及恢复一份既有 v5 旧备份；④ 对比阶段 0（M3）基线记录最新 ARM64 Release APK 体积与冷启动耗时，追加至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `mistake-review`、`knowledge-cards` 同步为主规格并合并 `local-storage` 与 `local-backup-restore` 的更新，标志 **V0.4（M2-C）全量达成**。
