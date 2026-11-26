# skill-turn-runtime Specification

## ADDED Requirements

### Requirement: Turn scoped discovery and explicit invocation
Host SHALL 依据已启用且绑定当前 LF01/小老师 scope 的包解析本轮快照。显式选择使用结构化 ID/revision，自动发现仅提供允许 model invocation 的名称/描述或分页清单；显式选择遵守 user-invocable。自动 load_skill 和 read_skill_file 仅访问授权快照。MUST 维持现有业务工具白名单与模型功能边界。

#### Scenario: Explicitly select a teaching skill
- **WHEN** 用户在问答 composer 选择已绑定技能并发送消息
- **THEN** Host 验证版本和 scope，装配正文及必要工具，保存选择及真实加载收据

#### Scenario: Model invokes a relevant skill
- **WHEN** 已启用自动调用的 Skill 与用户任务匹配
- **THEN** 模型可通过 list_local_skills/load_skill 取得指令并按需读取包内文本 references，访问次数及上下文长度有界

#### Scenario: Skill attempts unauthorized tool or file access
- **WHEN** 技能要求未授权工具、绝对路径、另一包文件或凭据
- **THEN** Host 拒绝该调用；既有学习域权限和密钥保持隔离

### Requirement: Historical receipts and base chat compatibility
Host SHALL 保存实际加载的 Skill ID、名称、revision 及结果，取消、失败、重试保留真实状态。MUST NOT 将选择等同于执行成功，MUST NOT 静默替换已失效版本。无 Skill 的 LF01、小老师与 LF02 原逻辑不变。

#### Scenario: Retry after a skill is uninstalled
- **WHEN** 历史消息明确选择的旧 revision 不再可读或无权
- **THEN** 应用提示重新选择，不使用其它版本冒充原任务

#### Scenario: Ordinary chat without a skill
- **WHEN** 未启用或选中任何适用 Skill
- **THEN** 问答、导航、小老师、取消与恢复仍按原契约运行


### Requirement: Extension preparation failures and execution receipts
Host SHALL distinguish a validated selection from actual instruction loading and actual tool settlement; typed preparation failures MUST preserve a safe reason and recovery action. A receipt alone MUST NOT satisfy the successful answer condition. Host SHALL preserve existing structured business deliverables (e.g. handoff and question cards), persist bounded settled receipts and represent unconfirmed calls after interruption honestly.

#### Scenario: Skill revision missing during retry
- **WHEN** a retry refers to a removed or unauthorized revision
- **THEN** the user sees a specific reason and reselect action, no substitute skill is silently loaded, and no model call is made

#### Scenario: Model emits no answer after loading a skill
- **WHEN** there is only a load receipt and no answer or legitimate structured business deliverable
- **THEN** the turn is not reported as a successful answer; existing handoff-only and question-card terminal semantics remain valid

#### Scenario: Concurrent load or read exceeds turn budget
- **WHEN** multiple permitted skill calls concurrently reserve the remaining budget
- **THEN** aggregate limits are not exceeded, excess calls receive a bounded error, and prior receipts remain accurate

#### Scenario: Process ends after skill load
- **WHEN** the application is killed after a load settles or before an invocation settles
- **THEN** saved receipts identify the actual revision and settled status; unconfirmed activity is interrupted or unknown, not fabricated as successful
