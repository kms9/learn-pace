# Spec Delta

## Purpose

定义「学习」Tab 的学习首页（对应 DeepTutor `LearningDashboard`）与跨页面的进度一致性。

## ADDED Requirements

### Requirement: What needs your attention
The 学习 tab SHALL show 「该做的事」 listing, up to five items, mastery sessions with an open or ungraded question card (opening that session) and then paths with due reviews shown as 「N 项复习已到期」 (starting a review session with the due-items opening message).

#### Scenario: Due reviews on the learning home
- **WHEN** 一条精通之路有 2 项复习到期
- **THEN** 「该做的事」显示该路径与「2 项复习已到期」，点击后新建复习会话并发送列出这两项的开场消息

#### Scenario: Waiting question card
- **WHEN** 某个精通会话中有一张未作答的题卡
- **THEN** 「该做的事」列出该会话与题干摘要，点击回到该会话且题卡仍可作答

### Requirement: Learning records and empty state
The learning home SHALL list all mastery topics under 「学习记录」 with emoji, name, mastered-over-total progress, and due count, showing six by default with 「展开显示」, and SHALL show a Mastery Path entry card that opens the creation wizard when no topic exists.

#### Scenario: First launch with no topics
- **WHEN** 用户没有任何精通之路时打开「学习」
- **THEN** 页面显示「精通之路」入口卡片，点击打开新建精通目标向导

### Requirement: Consistent progress across screens
The learning home, Mastery Path list, path page, and session progress ring SHALL compute mastered count (including self-reported), total, percentage, due count, and next action from one shared summary function and the same clock, and SHALL refresh on focus, on return to foreground, and after a tutor turn ends.

#### Scenario: Same numbers everywhere
- **WHEN** 某路径共 4 个知识点、已掌握 2 个、1 项到期，用户依次查看学习首页、精通之路列表、路径页与会话
- **THEN** 四处都显示 2 / 4（50%）与 1 项到期

#### Scenario: Refresh after a review failure
- **WHEN** 学习者在复习中答错使一个知识点回落，然后回到学习首页
- **THEN** 已掌握数减 1，该路径不再显示为已完成
