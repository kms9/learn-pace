# Proposal

## Why

DeepTutor 的复习就是一个复习模式的精通会话：导师只对已掌握的知识点出题，到期项优先，评分走与学习相同的管线；路径页的「复习计划」列出到期与即将到期的项目、遗忘风险与原因，并可调整复习策略与记忆保持目标；首页、精通之路列表与路径页都有进入复习的入口，进入时自动发送列出到期项的开场消息。没有单独的复习队列页或结算页。原 Change 5 的专用队列、提示按钮与结算卡与此不同，因此重写为本 Change（AC-06）。

## What Changes

- **复习模式规则（`packages/app-host`）**：
  - `mastery_quiz`、`mastery_assess` 在复习模式只接受已掌握的知识点，其余返回拒绝（同上游 `_review_scope_refusal`）；
  - 状态快照列出到期与即将到期的复习项；
  - 复习模式提示词按 DeepTutor `session.review`，并补一句「复习告一段落时，在会话中总结本次结果与各项下次复习时间」（Learn Pace 补充，替代结算页）；
  - 复习失败的回落与补救沿用 Change 4′ 的评分管线。
- **复习入口与开场消息（`packages/app-host`、`apps/mobile`）**：
  - 「精通之路」列表的到期横幅、路径页「下一个」为复习时的「开始本次复习」、复习计划中每项的开始按钮，都新建复习模式会话；
  - 进入时自动发送「我们来复习今天到期的这几项：……。」或「我们来复习一下我已经学过的内容。」。
- **复习计划面板（路径页）**：
  - 「复习计划」列出到期（「现在可复习」）与即将到期项，以及遗忘风险、原因与近期失误；
  - 「复习策略」可选默认或四个内置模板，「记忆保持目标」可在 70%–99% 调整，调整后重排复习计划；
  - 无到期项时显示「今天没有待复习的内容。继续学习，到时间会自动提醒你复习。」。
- **开发用时钟（`apps/mobile`）**：`__DEV__` 构建可设置时钟偏移（天），用于真机验证到期复习；Release 构建始终使用系统时钟。

### Out of Scope（本 Change 明确不做）
- 复习结算页、题卡提示按钮（已按 D7 修订删除）。
- 自定义复习间隔编辑器（DeepTutor 有，列为后续项）。
- 学习首页「该做的事」中的复习入口（Change 6′）。
- 跨时区、时间回拨故障注入与可控时钟全量回归套件（M2-B Change 8）；原子事务与 CAS（D3）。

## Capabilities

### New Capabilities
- `mastery-review`: 复习模式（只考已掌握知识点、到期优先、会话内总结）、复习入口与开场消息、复习计划面板（到期列表、遗忘风险、复习策略、记忆保持目标）、失败回落与补救后的再入队，以及开发时钟。

### Modified Capabilities
<!-- 无 -->

## Dependencies

- Change 4′ 已归档（题卡、评分管线、证据抽屉）。

## Impact

- **`packages/app-host`**：`mastery/tools/` 中出题与定性评估工具增加复习范围校验；`mastery/status.ts` 增加复习项；`mastery/prompts.ts` 增加复习总结句；`session-service.ts` 增加复习入口、开场消息、复习计划查询与策略设置；测试。
- **`packages/domain`**：复用 `builtinReviewTemplates`、`schedulerForProgress`、`setDesiredRetention`、`dueReviews`、`reviewableTasks`；新增绑定内置策略的函数与测试。
- **`apps/mobile`**：`app/(tabs)/paths.tsx` 到期横幅、`app/mastery/[pathId]/index.tsx` 复习计划面板与「开始本次复习」、`src/context/AppContext.tsx` 提供 `Clock`、`app/(tabs)/me.tsx` 开发区时钟偏移。
- **验证**：`corepack pnpm typecheck`、`corepack pnpm test` 全绿；Android 真机完成新 AC-06。
