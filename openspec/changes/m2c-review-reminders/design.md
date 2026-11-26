# Design

## Context

参见 `proposal.md` 与 `docs/prd/09-acceptance-criteria.md` AC-09。M2-B 已归档 `RestoreGate`、本地备份恢复与 `Clock` 注入。本 Change 遵循「Domain 纯计算 → App-Host 编排 → Mobile 平台桥接」分层，使排程逻辑完全可在 Node 下用可控时钟测试。

## Goals / Non-Goals

**Goals:**
- 纯领域排程函数与平台通知 API 彻底解耦，单测覆盖跨天、静默时段、多路径合并与关闭开关。
- 真机上同时兼容开发时钟（`devClock`）短间隔实测与真实日历排程。
- 点通知跳转严格遵守「等启动完成 → 等 `RestoreGate` 放行 → 查实时 `dueReviews` → 防重复创建会话」。

**Non-Goals:**
- 不做服务端推送或云端同步。
- 不将系统通知 ID 写入备份文件。

## Decisions

### 1. 纯领域提醒排程器（`packages/domain/src/reminders.ts`）
- 偏好结构（存入 `settings["review-reminder-settings"]`）：
  ```ts
  export interface ReminderPreferences {
    enabled: boolean;
    /** 每日首选提醒时间，分钟偏移（0–1439，默认 20 * 60 = 1200 即 20:00）。 */
    preferredMinute: number;
    /** 静默时段起止分钟（支持跨午夜，默认 22:00–08:00 即 1320–480）。 */
    quietStartMinute: number;
    quietEndMinute: number;
  }
  ```
- 纯函数 `planReviewReminders(inputs: ReminderDueItem[], prefs: ReminderPreferences, nowSeconds: number, options?: { horizonDays?: number; timezoneOffsetMinutes?: number; shortDelaySeconds?: number }): PlannedReminder[]`：
  - 若 `!prefs.enabled` 或无复习项，返回 `[]`；
  - 默认向前规划 `horizonDays = 7` 天（最多 7 条系统本地通知，避免触及 Android 闹钟数量上限）；
  - 按本地日历天归并到期项：对每个候选天取首选提醒时刻（若落在静默时段内，顺延至静默结束时刻），仅当该时刻已有 `due_at <= triggerAt` 的已掌握知识点时生成一条 `{ triggerAt, dueCount, pathIds }`，确保每日最多一条且绝不落在静默时段内；
  - 每天统计的 `dueCount` 与 `dueReviews(progress, triggerAt)` 口径一致。

### 2. 应用层提醒服务（`packages/app-host/src/reminders.ts`）
- 定义平台适配端口 `NotificationSchedulerPort`：
  - `getPermissionStatus(): Promise<"granted" | "denied" | "undetermined">`
  - `requestPermission(): Promise<"granted" | "denied">`
  - `replaceScheduled(items: readonly { id: string; delaySeconds: number; title: string; body: string; data: Record<string, unknown> }[]): Promise<void>`
  - `cancelAll(): Promise<void>`
- **相对延迟转换（兼容开发时钟）**：向 `NotificationSchedulerPort` 下发通知时，统一计算 `delaySeconds = Math.max(1, Math.round(item.triggerAt - clock.nowSeconds()))`，这样在 `__DEV__` 调整开发时钟或短间隔验证时，无需修改 Android 系统时钟即可在几秒到几十秒内真实触发系统通知！
- `ReviewReminderService` 负责：
  - 读写 `settings["review-reminder-settings"]`（缺省为 `{ enabled: true, preferredMinute: 1200, quietStartMinute: 1320, quietEndMinute: 480 }`，仅在权限已授权或首次有到期复习项时按策略触发请求）；
  - `reschedule(options?: { requestPermissionIfNeeded?: boolean })`：从 `AppStore` 读取全部路径，算出 `planReviewReminders`，更新系统排程；若权限被拒，静默返回不抛错；
  - 在 `MasterySessionService`（评分提交、复习完成、修改策略/保持目标、重置/删除路径）、`BackupRestoreService`（恢复完成后）、`AppContext`（应用回前台）与「我的」修改设置 5 处触发 `reschedule()`（非阻塞尽力而为，不拖慢主写入事务）；
  - `resolveNotificationTarget()`：供点通知后调用——先检查 `restoreGate` 未处于恢复中，实时查询所有路径的 `dueReviews`：
    - `duePaths.length === 0` → `{ kind: "home", notice: "当前暂无到期复习" }`；
    - `duePaths.length > 1` → `{ kind: "home" }`；
    - `duePaths.length === 1` → 检查该路径是否已有未结束（或最新且处于 `review` 模式且非空/待答题）的复习会话，有则 `{ kind: "session", pathId, sessionId }`，无则 `{ kind: "new_review", pathId }`。

### 3. Android 通知渠道、深链与防重入（`apps/mobile`）
- 引入 `expo-notifications`（`58.1.7`），在 `app.json` 配置图标/通道并创建 Android 通道 `review-reminders`（重要级别 `DEFAULT`）。
- 权限策略：冷启动只读 `getPermissionsAsync()`，**绝不调用 `requestPermissionsAsync()`**；仅当检测到首次有复习计划排入（在非冷启动的用户交互后，如首次达标后）或在「我的」开启提醒开关时调用一次请求；用户拒绝后记录已拒绝状态，在「我的」卡片提供「去系统设置开启」引导。
- 点通知处理（`apps/mobile/app/+native-intent.tsx` + `AppContext` 的 `addNotificationResponseReceivedListener` & `getLastNotificationResponseAsync`）：
  - 用 `handledResponseIds` Set + 导航互斥锁对同一 `notification.request.identifier` 去重，防止快速连点或冷启动双触发创建多个复习会话；
  - 始终等待 `AppContext` 完成冷启动 `recoverOnStartup()` 与 `RestoreGate` 放行后，再调用 `reminders.resolveNotificationTarget()` 执行 `router.navigate` / `router.push`。
- 「我的」新增「复习提醒」`Card`（遵循 `m2a-mobile-ux-polish` 的 `theme.ts` 与组件规范）：总开关、提醒时间选择、静默时段展示/选择、权限提示，以及 `__DEV__` 下的「10 秒后发送测试提醒」辅助按钮。

## Risks / Trade-offs

- **[Risk] Android 平台下 `adb shell am force-stop` 会将应用置入 `stopped` 状态并由系统主动清除全部定时闹钟** → Mitigation：这是 Android 系统机制而非应用缺陷；真机验收明确测试「划掉后台最近任务后触发」与「开启自启动后重启手机触发」，并在 README 注明 MIUI 省电/自启动测试前提。
- **[Risk] 通知提前排程的文案到期数可能在弹出前已变化** → Mitigation：用户点击通知后一律按打开瞬间的实时 `dueReviews` 决定跳转，且每次复习/回前台都会及时覆盖旧通知。
