# Spec Delta

## Purpose

定义 Learn Pace 的本地遗忘曲线复习提醒能力：纯领域排程、多时机自动重排、延迟权限申请与拒权降级、设置随备份流转，以及点击通知后的安全实时路由（对应 V0.4 AC-09）。

## ADDED Requirements

### Requirement: Deterministic daily reminder planning with quiet hours
A pure domain planner SHALL compute upcoming reminder timestamps and due counts from all paths' due review timestamps, user reminder preferences (enabled, preferred time, quiet hours), and current time, emitting at most one reminder per local calendar day and never scheduling inside quiet hours.

#### Scenario: Planning reminders across multiple paths and quiet hours
- **WHEN** 两条路径分别在静默时段（如 23:30）和次日上午到期，用户提醒时间为 20:00、静默时段为 22:00–08:00
- **THEN** 排程函数将静默时段内的到期合并顺延至次日非静默提醒时刻，每天最多产出一条汇总提醒且到期数准确

#### Scenario: No due or upcoming reviews clears planned reminders
- **WHEN** 所有路径均无已掌握或待排程复习项，或用户关闭复习提醒
- **THEN** 排程函数返回空计划，系统取消全部既有待触发通知

### Requirement: Automatic rescheduling across learning lifecycle events
The host reminder service SHALL store preferences in `settings` (included in local backups while OS scheduled notifications are excluded) and MUST recalculate and reconcile scheduled notifications after grading/review commits, backup restores, topic resets or deletions, foreground resumes, and reminder preference updates.

#### Scenario: Rescheduling after completing review or restoring backup
- **WHEN** 用户完成一轮复习使到期项延后，或从本地备份恢复包含到期路径的数据
- **THEN** 提醒服务自动重算排程并替换旧的系统待触发通知，不再推送已过时的到期数

### Requirement: Deferred notification permission and graceful degradation
The application MUST NOT prompt for notification permission on cold launch; it SHALL request permission only when the first review task enters the reminder schedule or when the learner enables reminders in Settings, and denying permission MUST degrade cleanly without errors or blocking any learning flow.

#### Scenario: Permission denied degrades cleanly
- **WHEN** 用户在系统弹窗拒绝通知权限后继续学习、复习或查看「我的」
- **THEN** 应用不崩溃、不反复弹窗打扰，在「我的」提醒卡片显示权限未开启状态与前往系统设置的引导入口

### Requirement: Safe notification tap routing with live due check and deduplication
Tapping a review reminder notification SHALL wait for app startup and `RestoreGate` clearance before routing based on live `dueReviews`: opening or resuming an existing unfinished review session when exactly one path has due items, opening Learning home 「该做的事」 when multiple paths have due items or none remain due, and deduplicating repeated taps so duplicate review sessions are never created.

#### Scenario: Single due path resumes existing review session without duplicating
- **WHEN** 仅路径 A 有到期复习且已存在一条未结束的复习会话，用户连续两次点击同一条复习通知
- **THEN** 应用在启动与 `RestoreGate` 放行后直接恢复该复习会话，不新建第二个复习会话

#### Scenario: Multiple due paths route to Learning home attention section
- **WHEN** 路径 A 与路径 B 均有到期复习，用户点击复习提醒通知
- **THEN** 应用跳转到「学习」Tab 的「该做的事」，通知、首页与路径页的到期数一致
