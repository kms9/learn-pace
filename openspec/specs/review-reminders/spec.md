# review-reminders Specification

## Purpose

定义 Learn Pace 的本地遗忘曲线复习提醒能力：纯领域排程、多时机自动重排、延迟权限申请与拒权降级、设置随备份流转，以及点击通知后的安全实时路由（对应 V0.4 AC-09）。

## Requirements

### Requirement: Deterministic daily reminder planning with quiet hours
纯领域排程函数 SHALL 根据各路径的复习到期时间、用户提醒设置（开关、首选时间、静默时段）与当前时间计算提醒时间和到期数。每个本地日历日最多生成一条提醒，触发时间须避开静默时段。

#### Scenario: Planning reminders across multiple paths and quiet hours
- **WHEN** 两条路径分别在静默时段（如 23:30）和次日上午到期，用户提醒时间为 20:00、静默时段为 22:00–08:00
- **THEN** 排程函数将静默时段内的到期合并顺延至次日非静默提醒时刻，每天最多产出一条汇总提醒且到期数准确

#### Scenario: No due or upcoming reviews clears planned reminders
- **WHEN** 所有路径均无已掌握或待排程复习项，或用户关闭复习提醒
- **THEN** 排程函数返回空计划，系统取消全部既有待触发通知

### Requirement: Automatic rescheduling across learning lifecycle events
应用层提醒服务 SHALL 将提醒设置存入 `settings`。本地备份包含提醒设置，系统通知排程仅保留在操作系统中。评分或复习提交、备份恢复、路径重置或删除、应用回到前台，以及修改提醒设置后，服务 MUST 重算并更新系统通知排程。

#### Scenario: Rescheduling after completing review or restoring backup
- **WHEN** 用户完成一轮复习使到期项延后，或从本地备份恢复包含到期路径的数据
- **THEN** 提醒服务自动重算排程并替换旧的系统待触发通知，不再推送已过时的到期数

### Requirement: Deferred notification permission and graceful degradation
应用在冷启动时 MUST NOT 弹出通知权限询问。首个复习任务进入提醒排程或学习者在设置中开启提醒时，应用 SHALL 请求权限。权限被拒时应用 MUST 平稳降级，学习流程可继续使用。

#### Scenario: Permission denied degrades cleanly
- **WHEN** 用户在系统弹窗拒绝通知权限后继续学习、复习或查看「我的」
- **THEN** 应用不崩溃、不反复弹窗打扰，在「我的」提醒卡片显示权限未开启状态与前往系统设置的引导入口

### Requirement: Safe notification tap routing with live due check and deduplication
用户点击复习通知后，应用 SHALL 等待启动完成及 `RestoreGate` 放行，并依据实时 `dueReviews` 跳转。恰好一条路径有到期项时打开或恢复该路径的未结束复习会话。多条路径有到期项或当前已没有到期项时，跳转到学习首页的「该做的事」。重复点击须去重，确保同一复习会话只创建一次。

#### Scenario: Single due path resumes existing review session without duplicating
- **WHEN** 仅路径 A 有到期复习且已存在一条未结束的复习会话，用户连续两次点击同一条复习通知
- **THEN** 应用在启动与 `RestoreGate` 放行后直接恢复该复习会话，不新建第二个复习会话

#### Scenario: Multiple due paths route to Learning home attention section
- **WHEN** 路径 A 与路径 B 均有到期复习，用户点击复习提醒通知
- **THEN** 应用跳转到「学习」Tab 的「该做的事」，通知、首页与路径页的到期数一致
