# Tasks

> 前置：M2-A 全量、`refine-mobile-learning-experience` 与 `m2a-mobile-ux-polish` 均已归档。开工前先提交当前 M2-A 收尾改动作为基线，再基于该基线实施本 Change。

## 1. SQLite v5 Migration & Transactional Store (`packages/infra`)

- [ ] 1.1 在 `packages/infra/src/migrations.ts` 新增 `migrateV5`（整体包裹在 `BEGIN IMMEDIATE … COMMIT` 中）：`learning_progress` 增加并回填 `version` 列；对重复非空 `submission_id` 按 `(updated_at DESC, interaction_id DESC)` 保留一行、其余置为 `NULL`；建立 `interactions.submission_id` 非空唯一索引；新增 `domain_events` 表及索引；迁移链改为按版本条件调用 `migrateV4`。在 `packages/infra/src/__tests__/migration-sql.test.ts` 验证空库、v1/v2/v3/v4 及含重复 `submission_id` 的库均可幂等无损升至 v5。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。
- [ ] 1.2 在 `packages/infra/src/{index,memory,expo}.ts` 导出 `VersionConflictError`、`SubmissionConflictError`、`StoredDomainEvent`，为 `AppStore` 实现 `runInTransaction`（可重入）、`saveWithCas`、`findInteractionBySubmission`、`appendDomainEvent`、`listDomainEvents`、`deleteDomainEventsByPath`，并让现有 `save` 同步写入 `version` 列。`ExpoLearningStore`：打开时设置 `PRAGMA busy_timeout = 5000`，所有写方法与事务经内部写入队列串行，事务经 `withExclusiveTransactionAsync` 且全部读写走 `txn`；`MemoryAppStore`：同样的写入队列 + 快照回滚。运行 `corepack pnpm --filter @learn-pace/infra typecheck`。
- [ ] 1.3 扩展 `packages/infra/src/__tests__/migration-sql.test.ts` 的 expo-sqlite mock，用第二个 `DatabaseSync` 连接实现 `withExclusiveTransactionAsync`；在该文件与 `memory-store.test.ts` 中验证：事务回滚、CAS 成功与冲突、`save` 后 `version` 列与 JSON 一致、事务进行中主连接写入排队完成而非报 `database is locked`、领域事件落库与按路径删除，两种实现行为一致。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。

## 2. Idempotent Submission, Uniform CAS & Late-Result Guard (`packages/app-host`)

- [ ] 2.1 在 `packages/app-host/src/mastery/study.ts` 与 `session-service.ts` 中：`stage` 接收调用方 `submissionId`（`gradeFromTurn` 仍由服务端生成）；`submitAnswer` 增加必填 `submissionId` 参数并返回 `SubmitAnswerResult`（`turn` / `receipt`），按设计第 3 节判定：其他题卡占用或同 ID 异作答抛 `SubmissionConflictError`；同 ID 已定论返回 `receipt` 且不写消息、不开回合；同 ID 待评分等价于 `retryAnswer`；新 ID 仅接受 `awaiting_input` / `answered` 题卡，并在短事务内写入作答与 `AnswerRecorded`。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [ ] 2.2 在 `packages/app-host/src/mastery/study.ts` 中改造 `grade`、`assess`、`repair`：`assessSemantically` 留在事务外；写成功结果或 `grading_failed` 前在事务内重新核对 `status === "answered"` 与 `submission_id`；成功结果以 `saveWithCas(next, baseVersion)` 提交，旧 `version` 统一抛 `VersionConflictError` 并保留原答案；同一事务内写入 `AssessmentCommitted` / `AssessmentVoided` / `AssessmentCorrected`。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [ ] 2.3 在 `packages/app-host/src/mastery/session-service.ts` 与 `packages/app-host/src/mastery/tools/index.ts` 中：`persist` 改为事务内 `saveWithCas(progress.version + 1, expected = progress.version)`，大纲写入连同放弃不兼容题卡一起提交并追加 `OutlineCommitted`；`createTopic` 使用 `saveWithCas(progress, null)`；`resetTopic` 单事务放弃未结束题卡并保存进度；`deleteTopic` 单事务删除题卡、精通会话与消息、进度与该路径 `domain_events`。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [ ] 2.4 新增 `packages/app-host/src/__tests__/transactions-idempotency.test.ts`，覆盖：同 ID 同作答在「已定论 / 待评分」两种状态下分别返回 `receipt` 与恢复批改，且均不重复计分；同 ID 异作答、同 ID 用于其他题卡被拒；已关闭/放弃题卡拒绝新 ID；晚到成功或失败结果无法覆盖已更新的题卡（绕过 `withPath` 直接驱动 `StudyInteractions` 构造）；旧 `version` 评分提交触发 CAS 拒绝且保留已保存答案；事务中途抛错整体回滚；`mastery_repair_question` 作废/更正原子提交与回滚；大纲预览版本冲突拒绝；删除主题无残留记录与事件；外部模型调用发生在事务外。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Mobile Submission Stability & Conflict Refresh (`apps/mobile`)

- [ ] 3.1 在 `apps/mobile/src/components/mastery/QuestionCard.tsx` 中为每次未完成作答维护 `submissionId`（`randomUUID`，作答内容变化时刷新），`submit(answers, submissionId)`；在 `apps/mobile/app/mastery/[pathId]/session/[sessionId].tsx` 中透传给 `submitAnswer`，收到冲突、过期拒绝或 `receipt` 时用统一语义提示样式反馈并刷新会话与题卡投影。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Android ARM64 Physical Device Verification (AC-05 Partial)

- [ ] 4.1 在 Android 真机（`86ceabbf`）安装包含 SQLite v5 的构建：验证从既有 v4 数据库无损升级至 v5（原问答、小老师、路径、大纲与进度完整可读）；问答流式输出期间在精通会话提交评分，确认两边都正常完成且无 `database is locked`；已定论题卡连点提交不新增作答消息，待评分重试可恢复批改且不重复计分；验证大纲修订预览提交、题目作废重算与删除主题无残留数据。结果追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `transactional-persistence` 同步为主规格并合并 `local-storage` 的更新，随后进入 Change 8（`m2b-crash-recovery-and-clock`）。
