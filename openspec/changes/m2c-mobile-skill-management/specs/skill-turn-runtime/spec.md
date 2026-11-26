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
