# Proposal

## Why

Learn Pace 已在 M2-A/M2-B 完成了基于遗忘曲线的复习调度与持久化加固，但学习者退出应用后缺少主动触达，极易错过到期复习窗口。本地复习提醒是原生手机相对 DeepTutor Web 的核心留存优势：基于本地 `due_at` 自动排程通知，点通知直达复习会话或学习首页「该做的事」，把整条精通之路闭环盘活。

## What Changes

- **纯领域排程函数（`packages/domain`）**：新增纯 TypeScript 提醒排程算法，输入各路径的到期时间 `due_at`、用户提醒偏好（开关、每日提醒时间、静默时段）与当前时间，计算未来若干次的提醒时刻与每次到期数量（每日最多一次、避开静默时段）。
- **应用层提醒服务（`packages/app-host`）**：新增 `ReviewReminderService`，持久化提醒偏好至 `settings` 表（随本地备份导出恢复，系统通知排程本身不进备份），并在批改/复习落库、恢复备份、重置/删除路径、应用回前台与修改提醒设置 5 类时机自动重算并同步排程。
- **原生通知与深链跳转（`apps/mobile`）**：
  - 引入 Expo 58 匹配的 `expo-notifications`（`58.1.7`）并创建 Android 通知渠道；
  - 绝不在冷启动时弹出权限申请，仅在首个复习任务进入计划或用户主动开启开关时请求权限；被拒时静默降级、不报错；
  - 「我的」新增「复习提醒」设置卡片（开关、提醒时间与静默时段、权限状态与引导）；
  - 在 `+native-intent.tsx` 与通知点击监听中处理深链：先等待应用冷启动完成与 `RestoreGate` 放行，再读取**当前实时** `dueReviews` 路由（单路径到期进入或恢复已有未结束复习会话且防重复点击多开，多路径到期进入学习首页「该做的事」，0 项到期落首页并轻提示）。

### Non-Goals / Out of Scope
- **不引入云端推送服务（FCM / APNs 服务端）**：全部排程严格在设备本地完成，保持 NFR-01 离线独立运行。
- **不修改既有 FSRS 调度算法或 SQLite 表结构**：提醒设置写入既有 `settings` 表。
- **不做按单个知识点的精细闹钟列表**：按日汇总提醒，每日最多一条防打扰。

## Capabilities

### New Capabilities
- `review-reminders`: 定义本地遗忘曲线复习提醒的排程计算、自动重排触发点、权限延迟申请与降级、设置持久化以及点击通知后的防重入与实时路由行为（对应 V0.4 AC-09）。

### Modified Capabilities
（无；提醒偏好复用既有 `settings` 键值存储与备份机制，不修改已有能力规格。）

## Impact

- **受影响包**：`packages/domain`（纯排程函数与单测）、`packages/app-host`（`ReviewReminderService`、触发点接入与可控时钟测试）、`apps/mobile`（`expo-notifications`、Android 通知渠道、`+native-intent.tsx` 跳转与「我的」设置卡片）。
- **依赖影响**：新增 `expo-notifications`（`58.1.7`），需重编 Android ARM64 Release APK 并对照阶段 0 的 M3 基线记录体积与冷启动变化。
- **前置依赖**：M2-B 全部归档，且阶段 0 的 M3（AC-08）发布基线与 V0.4 范围决策表已确认。
