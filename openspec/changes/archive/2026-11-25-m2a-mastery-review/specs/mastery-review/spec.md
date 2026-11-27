# Spec Delta

## Purpose

定义精通之路的复习（对应 DeepTutor 复习模式与 `ReviewTrail`）：复习模式只考已掌握的知识点、复习入口与开场消息、会话内总结、复习计划面板，以及复习失败后的回落、补救与再入队。

## ADDED Requirements

### Requirement: Review mode tests only mastered objectives
In review mode, `mastery_quiz` and `mastery_assess` SHALL accept only objectives that are currently mastered and MUST return a refusal for others; reviewing MUST NOT require any item to be due.

#### Scenario: Refusing a new objective in review
- **WHEN** 复习模式中导师对一个未掌握的知识点出题
- **THEN** 工具返回「复习只考已经掌握的知识点」并不创建题卡

#### Scenario: Reviewing without due items
- **WHEN** 路径没有到期项，学习者进入复习模式要求「把我掌握过的都考一遍」
- **THEN** 导师可以对任意已掌握知识点出题

### Requirement: Review entry points and opening message
The system SHALL start a new review-mode session from the Mastery Path tab's due banner, the path page's 「开始本次复习」, and each review plan item, and SHALL send DeepTutor's opening message listing the due items, or 「我们来复习一下我已经学过的内容。」 when none are due.

#### Scenario: Starting review from the due banner
- **WHEN** 有两个知识点到期，用户点「精通之路」列表顶部的到期横幅
- **THEN** 应用新建复习模式会话并发送「我们来复习今天到期的这几项：A、B。」

### Requirement: In-session review summary
The review-mode tutor prompt SHALL instruct the tutor to summarize, when the review winds down or the learner wants to stop, which objectives were reviewed, their results, and their next review times, and unprocessed due items MUST remain due.

#### Scenario: Leaving review early
- **WHEN** 三个到期项中只复习了一个，学习者说想先结束
- **THEN** 导师在会话中总结这一项的结果与下次复习时间，另外两项仍显示为到期

### Requirement: Review plan panel
The path page SHALL show a 「复习计划」 panel listing mastered objectives' review items with 「现在可复习」 or relative due time, forgetting risk, reason, and recent lapses; it SHALL let the learner choose 「默认」 or a built-in review strategy and set the 「记忆保持目标」 between 70% and 99%, rescheduling items after each change.

#### Scenario: Raising the recall target
- **WHEN** 用户把记忆保持目标从 90% 调到 95%
- **THEN** 复习计划按新目标重排，未到期项的下次复习时间提前

#### Scenario: Nothing due
- **WHEN** 路径没有到期项
- **THEN** 面板显示「今天没有待复习的内容。继续学习，到时间会自动提醒你复习。」

### Requirement: Review failure, remediation, and return to review
An independent incorrect quantitative review answer SHALL record a lapse and an error and drop the objective below its gate so it leaves the review plan and returns to learning (reopening a completed path); an independent partial qualitative review SHALL revoke qualitative mastery without counting a lapse; after the objective clears its gate again it SHALL return to the review plan keeping its lapse count.

#### Scenario: Failed review reopens the path
- **WHEN** 已完成路径中的一个定量知识点在复习中被独立答错
- **THEN** 该知识点的失误次数加 1、掌握度跌破 90%、离开复习计划，路径回到学习中

#### Scenario: Remediated objective returns
- **WHEN** 学习者在学习模式中对该知识点连续独立答对五次
- **THEN** 知识点重新达标，并带着失误次数回到复习计划

### Requirement: Development clock offset
Debug builds SHALL offer an in-memory clock offset in days that all mastery screens and services use, and release builds MUST NOT expose it.

#### Scenario: Making an item due on a device
- **WHEN** 开发者在调试构建中把时钟偏移设为 4 天
- **THEN** 复习计划与到期横幅按偏移后的时间显示到期项
