# chat-quick-check Specification

## Purpose

定义 Learn Pace 在问答（LF01）中的「自测（考考我）」能力（PRD LF01-05）：由 Host 直接 JSON 生成 1–2 道理解检验题，持久化在消息 `metadata` 中、不触碰精通之路掌握度，支持强杀恢复、幂等提交评分，以及判分后继续聊或转为学习目标（对应 V0.4 AC-10）。

## Requirements

### Requirement: Direct JSON quick-check generation in chat
学习者点击已完成问答回复下方或输入框旁的「考考我」时，应用层 SHALL 使用有长度上限的近期问答上下文，直接以结构化 JSON 生成 1–2 道选择或简答题，校验并打乱选择题选项。判分前显示的题面不得泄露答案或解析。

#### Scenario: Generating a quick check from a chat reply
- **WHEN** 用户在问答完成一轮概念讲解后点击助手消息上的「考考我」
- **THEN** 系统基于近期对话生成 1–2 道合法的选择或简答题卡片，选项已打乱且判分前不显示答案与解析

#### Scenario: Generating a quick check from the composer shortcut
- **WHEN** 用户在已有对话的问答会话中点击输入框旁的「考考我」快捷入口
- **THEN** 系统基于该会话最近已完成对话生成 1–2 道自测题并展示在会话消息流中

### Requirement: Message-metadata persistence and idempotent grading
自测题卡、作答、评分和 `submission_id` MUST 仅保存在问答的 `messages.metadata` 中。提交作答 SHALL 复用选择题精确匹配和语义评分，MUST 按 `submission_id` 保证幂等。未答和已判题卡在应用强停重启后 MUST 可恢复。

#### Scenario: Force-stop recovery and idempotent submission
- **WHEN** 自测题尚未作答时应用被强杀并重启，用户随后作答并以相同 `submission_id` 重复提交两次
- **THEN** 重启后原自测题仍完整可答，重复提交仅评分一次并返回已有评分结果

### Requirement: Strict isolation from Mastery Path and smooth follow-up actions
自测出题和判分 MUST NOT 修改 `learning_progress`、`interactions`、`learning_evidence` 或复习计划。判分后，题卡 SHALL 提供「继续聊」和「转为学习目标」。点击后者会打开新建主题向导，预填来源会话的消息摘录和自测摘录。

#### Scenario: Quick check leaves mastery progress untouched
- **WHEN** 用户在问答中完成一次自测（含答对与答错）
- **THEN** 全部精通路径的 `learning_progress`、掌握度、证据与复习计划均保持零变化

#### Scenario: Turning a quick check into a learning goal
- **WHEN** 自测判分完成后用户点击「转为学习目标」
- **THEN** 应用跳转到新建精通目标向导并预选来源会话、消息与自测摘录
