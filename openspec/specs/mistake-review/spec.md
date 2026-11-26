# mistake-review Specification

## Purpose

定义 Learn Pace 的只读错题回看能力：基于既有学习证据与已批改题卡（及可选问答自测错题）投影错题列表，展示评分反馈与解析，并提供直达对应知识点的重练入口（对应 V0.4 AC-11）。

## Requirements

### Requirement: Read-only mistake projection consistent with path evidence
应用 SHALL 根据当前未作废且结果非 `correct` 的 `learning_evidence` 与已判分 `interactions` 的交集投影精通错题。错题数量须与路径证据一致，重置后须清除原错题的投影。问答自测错题 MAY 同列展示，并标注「未计入掌握」。错题回看 SHALL 仅使用现有数据库表和复习排程。

#### Scenario: Mistake count matches path evidence and clears after topic reset
- **WHEN** 用户在某精通路径答错两道题后查看错题回看，随后对该路径执行「重置进度」
- **THEN** 重置前错题回看展示这两道错题及反馈、解析与参考答案，数量与路径页有效非正确证据一致；重置进度后该路径的错题不再出现

#### Scenario: Chat quick-check mistake is labeled separately
- **WHEN** 用户在问答自测中答错一道题并打开错题回看
- **THEN** 该错题展示在列表中并明确标注「未计入掌握」，不触发精通路径的掌握度或复习计划变化

### Requirement: Direct remediation entry from a mistake
每条精通错题 SHALL 提供「去练这个知识点」。应用打开该路径的学习或复习会话，开场消息指向该错题所在的知识点，复习时机沿用现有遗忘曲线排程。

#### Scenario: Jumping from a mistake to practice its objective
- **WHEN** 用户在错题回看中点击某条精通错题的「去练这个知识点」
- **THEN** 应用打开该路径的学习会话（若知识点当前已掌握则可进复习会话）并自动带出针对该知识点的练习开场消息
