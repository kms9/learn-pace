# Tasks

> 前置：M2-B 全部归档，且阶段 0 的 **M3（AC-08）真机发布基线** 与 V0.4 范围决策表已确认。

## 1. Domain Reminder Planner (`packages/domain`)

- [x] 1.1 新增 `packages/domain/src/reminders.ts` 并在 `index.ts` 导出：`ReminderPreferences`、`PlannedReminder`、`defaultReminderPreferences` 与纯函数 `planReviewReminders`（跨路径合并、每日最多一次、避开跨午夜静默时段、无到期或关闭开关返回空数组）。新增 `packages/domain/src/__tests__/reminders.test.ts` 覆盖多路径合并、静默顺延、跨天与时区偏移、关闭开关。运行 `corepack pnpm --filter @learn-pace/domain typecheck && corepack pnpm test`。

## 2. Host Reminder Service & Lifecycle Hooks (`packages/app-host`)

- [x] 2.1 新增 `packages/app-host/src/reminders.ts` 实现 `ReviewReminderService` 与 `NotificationSchedulerPort`：读写 `settings["review-reminder-settings"]`（随备份保留）、以 `Math.max(1, triggerAt - clock.nowSeconds())` 计算相对触发延迟、权限延迟申请与拒权降级、以及受 `RestoreGate` 保护的 `resolveNotificationTarget()`（实时 `dueReviews`：0 项落首页提示、单路径复用已有未结束复习会话或新建、多路径落首页「该做的事」）。运行 `corepack pnpm --filter @learn-pace/app-host typecheck`。
- [x] 2.2 将 `reminders.reschedule()` 接入 5 类触发点：评分/复习提交、重置/删除路径（`MasterySessionService`）、恢复备份后（`BackupRestoreService`）、修改提醒设置、以及前台恢复入口；新增 `packages/app-host/src/__tests__/reminders.test.ts` 用可控 `FakeClock` 与模拟端口覆盖全部 5 类触发点、拒权降级、备份恢复重排、以及单路径复用/多路径跳转/重复点击不创建多会话。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 3. Mobile Notifications, Settings UI & Deep Link (`apps/mobile`)

- [x] 3.1 在 `apps/mobile/package.json` 安装 Expo 58 匹配的 `expo-notifications`（`58.1.7`），新增 `apps/mobile/src/notifications.ts` 实现 `NotificationSchedulerPort`（创建 Android 通知渠道、延迟权限申请、相对秒数触发排程、安全取消与通知点击去重）。运行 `corepack pnpm --filter @learn-pace/mobile typecheck`。
- [x] 3.2 在 `apps/mobile/src/context/AppContext.tsx` 持有 `ReviewReminderService` 并在启动完成、回前台及 `restart()` 后接入重排与通知点击监听（等启动与 `RestoreGate` 放行后再路由）；更新 `apps/mobile/app/+native-intent.tsx` 支持复习提醒深链；在 `apps/mobile/app/(tabs)/me.tsx` 新增「复习提醒」设置卡片（开关、每日提醒时间、静默时段、拒权时引导去系统设置，及 `__DEV__` 短倒计时测试触发）。运行 `corepack pnpm typecheck && corepack pnpm test`。

## 4. Android ARM64 Physical Device Verification (AC-09)

- [x] 4.1 重新构建 Android ARM64 Release APK（及调试构建）安装至真机（`86ceabbf`），完成 **AC-09** 验收：① 冷启动不弹通知权限，仅在产生首个复习任务或手动开启开关时申请；② 使用开发时钟与短间隔，在**划掉后台任务（非 `force-stop`）**后验证通知照常触发，在开启自启动后**重启手机**验证通知照常触发；③ 验证通知、学习首页「该做的事」与路径页三处到期数一致；④ 分别验证单路径到期点击（含连续重复点击不新开多会话）与多路径到期点击跳转；⑤ 拒绝通知权限确认正常降级无报错；⑥ 记录相对 M3 基线的 Release APK 体积与冷启动耗时变化，追加至 `apps/mobile/README.md`。

## Workflow follow-up

- 完成并验收后归档本 Change，将 `review-reminders` 同步为主规格。
