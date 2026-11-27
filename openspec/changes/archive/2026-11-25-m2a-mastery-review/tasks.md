# Tasks

> 前置：Change 4′ 已归档。

## 1. Review Rules & Plan (`packages/domain`, `packages/app-host`)

- [x] 1.1 在 `packages/domain/src/review-strategy.ts` 增加把内置模板绑定到路径（写 `review_strategy` 并重排）的函数，复用 `setDesiredRetention`；测试绑定与重排结果。运行 `corepack pnpm --filter @learn-pace/domain typecheck && corepack pnpm test`。
- [x] 1.2 在 `packages/app-host/src/mastery/` 中：`mastery_quiz`、`mastery_assess` 增加复习范围校验；`status.ts` 增加 `reviews`（到期与 7 天内即将到期）；`prompts.ts` 复习模式加入总结句并标注为 Learn Pace 补充；`session-service.ts` 增加新建复习会话与开场消息、复习计划查询、设置复习策略与记忆保持目标；`Clock` 注入。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 1.3 新增 `packages/app-host/src/__tests__/mastery-review.test.ts`（`MemoryAppStore` + 可推进的 `FakeClock` + 脚本化模拟网关）覆盖：复习模式拒绝未掌握知识点、无到期项也可复习、到期与非到期的开场消息、推进时钟后到期、独立答对延后下次复习、同会话重复答对不推后、辅助答对保持掌握且稳定度增长更低、定量独立答错使失误次数加 1、掌握回落、离开复习计划且已完成路径回到学习中、定性 `partial` 撤回掌握但失误次数不变、连续五次独立答对后带失误次数回到复习计划、更改记忆保持目标后重排。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 2. UI (`apps/mobile`)

- [x] 2.1 `apps/mobile/src/context/AppContext.tsx` 提供共享 `Clock`；`apps/mobile/app/(tabs)/me.tsx` 在 `__DEV__` 下提供时钟偏移（天），仅存内存。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 2.2 `apps/mobile/app/(tabs)/paths.tsx` 到期横幅进入复习会话；`apps/mobile/app/mastery/[pathId]/index.tsx` 增加「复习计划」面板（列表、遗忘风险、原因、失误标记、定位大纲、开始复习、复习策略、记忆保持目标、空态）与「下一个」为复习时的「开始本次复习」。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Android ARM64 Physical Device Verification (AC-06)

- [x] 3.1 在 Android 真机（`86ceabbf`）用调试构建完成新 **AC-06**：设置时钟偏移使已掌握知识点到期；从「精通之路」到期横幅进入复习会话并核对开场消息；独立答对一次（下次复习时间延后）、同会话再答对一次（到期时间不变）、独立答错一次（失误次数加 1、知识点回到学习中、路径从已完成回到学习中）；在学习模式补救至重新达标，推进时钟确认其带失误次数回到复习计划；三项到期只复习一项后结束，核对导师总结与剩余到期项；调整记忆保持目标观察重排；确认 Release 构建无时钟偏移入口。结果追加到 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `mastery-review` 同步为主规格。
