# Tasks

> 前置：Change 2 已归档；技术验证 S7 已通过（`GO`，见 `docs/evaluation/s7-tutor-loop-verification-report.md`，已回填 S7 校准结论：默认 `maxTurns: 8`、`reasoning: "high"` 及「出题前先输出简短可见引导语再调用 `mastery_quiz`」提示词约束）。

## 1. Domain (`packages/domain`)

- [x] 1.1 在 `packages/domain/src/models.ts` 增加 `TopicSource` 与 `LearningProgress` 可选字段 `goal`、`emoji`、`topic_sources`（`createLearningProgress` 给默认值）；在 `packages/domain/src/policy.ts` 增加 `derivePathStatus` 与 `resetProgress`（按 design 决策 1）。运行 `corepack pnpm --filter @learn-pace/domain typecheck`。
- [x] 1.2 新增 `packages/domain/src/objective-relations.ts`，移植 `upstream/deeptutor/deeptutor/learning/objective_relations.py`（ID 唯一、无自依赖、无未知先修、三色 DFS 环路检测并给出链路、来源引用有效且非 goal）。新增对应测试并移植上游边界用例。运行 `corepack pnpm test`。
- [x] 1.3 新增 `packages/domain/src/outline-identity.ts` 与 `outline-revision.ts`：语义身份映射（移植 `service.py` 第 240–306 行）、模块修订规划（`rewrite` / `add` / `remove`）、`reorderModules`、`stateDigest`、差异与影响摘要（移植 `outline_revision.py`）。测试覆盖同名同类型沿用 ID 与进度、改名产生新 ID 并清除其进度、重排保持 ID、非法 `module_order` 被拒、摘要不受 `version` / `updated_at` 影响。运行 `corepack pnpm test`。

## 2. Storage (`packages/infra`)

- [x] 2.1 在 `packages/infra/src/{index,memory,expo,migrations}.ts` 加入 SQLite v4：重建 `interactions` 表使状态约束包含 `abandoned`（无损复制）；`InteractionStore.abandonInteraction`、按路径删除题卡；`SessionStore` 按路径列出、更新、删除会话；`LearningProgressStore.delete`。在 `migration-sql.test.ts` 与 `memory-store.test.ts` 验证 v3→v4 升级保留记录及两种实现行为一致。运行 `corepack pnpm --filter @learn-pace/infra typecheck && corepack pnpm test`。

## 3. Runtime Adaptation & Mastery Session Host (`packages/runtime`, `packages/app-host`)

- [x] 3.1 核对并复用 S7 已落地的 `packages/runtime`（`PiDurableRuntime`）通用能力（普通 `RuntimeTool` 触发 `tool_terminated` 立即收尾、保留出题前实时 `text_delta` 流式推送、`RuntimeTurnRequest.maxTurns` 默认 `8`、兼容保留 M1 `register_question` 与既有 27 个 runtime 用例）；如有与 `MasterySessionService` 对接缺口则补齐并运行 `corepack pnpm --filter @learn-pace/runtime typecheck && corepack pnpm test`。
- [x] 3.2 从 `packages/app-host/src/lf01-chat.ts` 抽出 `chat-turns.ts` 回合引擎（消息落库、终态、冷启动恢复、重试、有界历史），问答与小老师改为使用它；既有测试保持通过。运行 `corepack pnpm typecheck && corepack pnpm test`。
- [x] 3.3 新增 `packages/app-host/src/mastery/session-service.ts`（`MasterySessionService`，由 `AppBootstrapService` 受控创建，默认 `maxTurns: 8`、`reasoning: "high"`）：创建主题（含 goal 来源与向导资料）、列表、读取、改名、重置进度、删除主题；创建、列出、打开会话；切换模式与准入；开场消息；发送与重试；单路径单回合锁。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 3.4 新增 `packages/app-host/src/mastery/prompts.ts`（移植 `upstream/deeptutor/deeptutor/capabilities/mastery/prompts/zh/mastery_loop.yaml` 的相关段落，文件头注明出处与 Apache-2.0，并按 S7 校准显式保留「调用 `mastery_quiz` 前先输出简短可见引导语再调用工具」约束）、`mastery/status.ts`（快照字段按 design 决策 3）与 `mastery/tools/` 下的 `mastery_status`、`mastery_profile`、`mastery_mode`、`read_source`、`mastery_build`、`mastery_revise`（工具权限校验读取会话当前实时模式而非回合初始快照；预览保存在内存并 1 小时过期）。
- [x] 3.5 新增 `packages/app-host/src/__tests__/mastery-session.test.ts`，用 `MemoryAppStore` 与按脚本返回工具调用的模拟网关覆盖：向导创建后发送开场消息、空大纲时拒绝进入学习模式、`mastery_build` 在学习模式被拒、同回合内调用 `mastery_mode` 切换模式后新模式工具立即生效、建出大纲后状态为学习中、`mastery_profile` 合并、替换大纲沿用同名同类型知识点、环路大纲被拒、预览后提交成功、过期或基线变化的预览被拒、同路径两个会话不能同时运行、强杀后消息恢复、重置进度与删除主题的范围、每轮请求含当前模式提示词与最新快照。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. UI (`apps/mobile`)

- [x] 4.1 `apps/mobile/app/(tabs)/paths.tsx`：「精通之路」列表、卡片、空态、「新建精通目标」、`dueReviews` 非空时的到期数量横幅。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.2 `apps/mobile/app/mastery/new.tsx`：两步向导（目标与图标；问答会话与选文、文本笔记、只读模型），读取 Change 2 的 `sourceSessionId`、`sourceMessageId`、`sourceExcerpt` 并预选；提交后进入新会话并发送开场消息。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.3 `apps/mobile/app/mastery/[pathId]/index.tsx`：路径页基础版（标题改名、目标、资料标签、进度、「下一个」按 `NEXT_LABELS` 文案、只读大纲、学习会话列表与新建、「更多」中的重置进度与删除主题及确认）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 4.4 新增 `apps/mobile/app/mastery/[pathId]/session/[sessionId].tsx` 并在 `app/_layout.tsx` 注册：模式切换、模式说明、进度环、大纲底部弹层（工具完成后刷新）、空会话标题与起手提示、消息流（`MessageContent`）、「大纲已就绪——共 N 个知识点」与「开始学习」、停止与重试、同路径另一会话运行中的等待提示。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 5. Attribution & Device Verification

- [x] 5.1 在仓库根新增 `NOTICE`，列出移植自 DeepTutor（`HKUDS/DeepTutor`，commit `1284116`，Apache-2.0）的提示词与算法文件，以及 Cherry Studio Mobile 的复用说明。
- [x] 5.2 在 Android 真机（`86ceabbf`）完成新 **AC-03**：从问答「转为学习目标」与在「精通之路」直接新建各一次；编辑大纲会话自动发送开场消息，导师询问基础与目标后建出大纲；要求导师修改一个模块并调整模块顺序（经预览提交）；确认大纲弹层刷新与「大纲已就绪」；点「开始学习」进入学习模式会话；强杀重启后路径 ID、资料、大纲、会话与模式恢复；重置进度与删除主题各一次。记录每轮首字延迟与 token 用量，追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `mastery-topics`、`mastery-session`、`mastery-outline` 同步为主规格。
