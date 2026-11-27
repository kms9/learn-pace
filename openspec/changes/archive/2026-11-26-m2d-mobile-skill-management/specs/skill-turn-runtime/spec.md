# skill-turn-runtime Specification

## Purpose

定义问答与 Dito 小老师在一次回合中选择、发现和读取教学技能的边界，确保版本固定、读取范围与预算受控，并让收据如实反映回合结果。

## ADDED Requirements

### Requirement: Turn scoped discovery and explicit invocation
Host SHALL 在回合登记为活跃之后，从同一份一致性快照解析当前作用域（`lf01` 或 `little_tutor`）已启用且已绑定的 Skill 及其 `active_revision`，得到不可变的本轮快照。新发送的显式选择 SHALL 只提交 `skillId`（每条消息至多 1 个）并遵守 `user-invocable`，由 Host 按快照的 `active_revision` 记录 `{ skillId, revision }`；重试时记录的 `revision` MUST 等于当前 `active_revision`；本轮已加载的 Skill（含显式选中）SHALL 可经 `list_skill_files`、`read_skill_file` 读取参考文本。自动发现 SHALL 仅在门禁通过时注册 `list_local_skills`、`load_skill`，只暴露允许 `model invocation` 的有限元数据。所有读取 MUST 限于本轮已加载固定版本内的支持文本，拒绝跨包/越界读取并维持既有工具白名单边界。

#### Scenario: Explicitly select a teaching skill in chat or Little Tutor
- **WHEN** 用户在问答或小老师输入框从当前可用技能菜单选择某已启用 Skill（生成可移除 chip）并发送消息
- **THEN** Host 校验作用域与启用状态后，用快照中的当前 `active_revision` 补全选择，把 `skill_selection: [{ skillId, revision }]` 持久化至用户消息元数据，并装配该版本指令运行回合
- **AND** 未绑定到当前作用域的 Skill 不会出现在菜单中，即便携带其 ID 也会被 Host 拒绝；输入框同一条消息至多选择 1 个 Skill

#### Scenario: Skill is updated after the chip is chosen
- **WHEN** 用户在输入框选好某 Skill 的 chip 后，该 Skill 经用户确认更新到新 revision，用户随后发送这条消息
- **THEN** 发送成功，Host 记录并装配更新后的 `active_revision`，不因 chip 选择时的旧版本报错

#### Scenario: Model discovers and loads a relevant skill with bounded references
- **WHEN** 自动发现门禁已通过，当前作用域存在启用且允许自动发现的 Skill，且模型调用 `list_local_skills`、`load_skill`、`list_skill_files` 与 `read_skill_file`
- **THEN** 模型仅能发现本作用域允许自动调用的 Skill，仅能读取本轮已加载固定版本 manifest 内的支持 UTF-8 文本文件，返回内容作为不可信数据隔离
- **AND** 若模型尝试读取未加载 Skill 的文件、绝对路径、越界相对路径或凭据路径，Host 拒绝该调用并维持既有学习域与密钥隔离

#### Scenario: Explicitly selected skill reads references when auto discovery is off
- **WHEN** 自动发现门禁未通过（或该 Skill 声明 `disable-model-invocation: true`），用户显式选择一个带参考文件的 Skill 并发送消息
- **THEN** 本轮只注册 `list_skill_files` 与 `read_skill_file`（不注册 `list_local_skills`、`load_skill`），模型可以读取该 Skill 固定版本内的参考文本
- **AND** 读取量计入本轮共享预算

#### Scenario: LF01 and Little Tutor take consistent snapshots during an update
- **WHEN** 用户确认把同时绑定到 `lf01` 与 `little_tutor` 的 Skill 从 revision A 更新到 revision B，而此时 LF01 与 Dito 各自正在开始一个新回合
- **THEN** 每个回合的快照要么完整基于 A，要么完整基于 B，不会出现启用状态、作用域绑定与 revision 来自不同时刻的混合结果
- **AND** 已基于 A 开始的回合在结束前始终读取 A，A 在这些回合结束后才被回收

### Requirement: Historical receipts and base chat compatibility
Host SHALL 在助手消息元数据中持久化轻量执行收据（实际 `skillId`、名称、`revision`、触发方式与终态），不复制整包正文，MUST NOT 将选择等同于执行成功或静默替换失效版本。当前作用域无适用 Skill 时，LF01、Dito 小老师、问答自测（`ChatQuickChecks` / `publicChatMessage`）、精通导航交接、停止、强杀恢复与 LF02 MUST 保持原有提示词、工具白名单与全部语义不变。

#### Scenario: Ordinary chat and quick checks without enabled skills
- **WHEN** 当前作用域未启用任何 Skill，用户在问答与小老师中正常对话、发起「考考我」自测、触发精通交接卡或强杀恢复
- **THEN** 系统不注入任何 Skill 指令，不注册任何 Skill 工具，原有问答、自测、交接卡与恢复行为与引入本 Change 前完全一致

#### Scenario: Coexistence of skill metadata with quick-check projection
- **WHEN** 会话中同时存在带 `skill_selection` / `skill_receipts` 的普通问答轮次和带 `quick_check` 的自测消息
- **THEN** `publicChatMessage` 正确保留普通消息的 Skill 选择与收据字段，同时继续对自测消息隐藏答案与解析；自测出题与 `regenerate` 不将失败的空回复纳入有效历史

### Requirement: Extension preparation failures and deliverable separation
Host SHALL 分离已校验选择、实际加载收据与业务可交付物。Host MUST 在写入任何用户消息、回复或会话变更之前完成扩展预解析；预解析失败 MUST 抛出脱敏类型化错误 `ExtensionPrepareError` 并提供明确原因与恢复引导，MUST NOT 发起模型请求、改动既有消息或折叠为泛化模型故障。`retry` 与 `regenerate` MUST NOT 改写历史用户消息中的 `skill_selection`。仅有 Skill 加载/读取收据而无有效正文回答或既有合法结构化业务交付物（如 `handoffs` 或题卡）时，回合 MUST NOT 标为 `committed`。

#### Scenario: Retry fails safely when historical skill revision is missing
- **WHEN** 用户对一条历史上显式选择了某 Skill revision 的回复点击「重试」或「重新生成」，而该 revision 已被卸载、停用、解除当前作用域绑定或依赖不满足
- **THEN** Host 在写入任何消息之前抛出类型化 `ExtensionPrepareError`（`revision_missing`、`scope_denied`、`skill_disabled` 或 `dependency_missing`），向用户展示明确原因，不静默替换其他版本且不发起模型请求
- **AND** 原用户消息（含其 `skill_selection`）与原回复（含已 `committed` 的回答）保持不变
- **AND** 应用提供「用当前版本重新发送」：将原正文、引用以及该 Skill 在当前作用域仍可显式调用时的 chip 回填输入框，由用户确认后作为新一轮发送并绑定当时的 `active_revision`；该 Skill 已不可用时只回填正文与引用并说明原因

#### Scenario: Sending with an unavailable explicit skill leaves no partial turn
- **WHEN** 用户发送带有 Skill chip 的消息，而该 Skill 在发送前已被停用、解除当前作用域绑定、卸载或依赖不满足
- **THEN** Host 抛出 `ExtensionPrepareError` 且不保存用户消息或空回复，输入框保留草稿与 chip 并展示原因

#### Scenario: First message of a new chat with an invalid skill chip writes nothing
- **WHEN** 用户在没有当前会话的问答页输入消息并附带一个已失效的 Skill chip 后发送
- **THEN** Host 在创建会话之前完成预解析并抛出 `ExtensionPrepareError`，数据库不新增会话、消息或任何其他行
- **AND** 输入框保留草稿与 chip 并展示原因；修正选择后再次发送才创建会话

#### Scenario: Load receipt alone does not mark an empty reply as committed
- **WHEN** 模型在回合中成功调用 `load_skill` 并产出收据，但最终结束回合时未生成非空正文回答，也未产生 `handoffs` 等合法业务交付物
- **THEN** 该回复不被标记为 `committed`，而是落为失败状态并保留真实收据；同时既有的仅含 `handoffs` 或题卡终止的合法业务回合保持成功语义不变

### Requirement: Bounded concurrent turn budget and checkpointed receipts
Host SHALL 使用回合级共享原子预留预算约束并发 Skill 工具调用，确保单轮累计用量不越限，并随工具落定与流式 checkpoint 增量合并持久化轻量收据。进程强杀或中断后，未确认的活跃调用 MUST 诚实标为 `interrupted` 或 `unknown`，且流式 checkpoint MUST NOT 以旧元数据覆盖已落定收据。

#### Scenario: Concurrent skill calls respect shared turn-wide budget
- **WHEN** 模型在单轮内并发发出多个 `load_skill` 或 `read_skill_file` 调用且总请求量超过本轮剩余预算（每轮最多 3 个 Skill；`SKILL.md` 正文与参考文件合计 ≤ 24,000 字符，显式预注入的正文同样计入；单次引用 ≤ 8,000 字符；每轮 Skill 工具调用 ≤ 12 次；另受 `maxTurns` 与模型上下文约束）
- **THEN** 共享原子预留机制保证累计用量绝不越限，超额调用返回有界错误码，此前已成功预留的调用收据保持准确

#### Scenario: Process termination preserves settled receipts honestly
- **WHEN** 应用在某 `load_skill` 已落定且后续调用尚未完成时被强杀并重启
- **THEN** 恢复后的消息保留已落定调用的真实 `skillId` 与 `revision` 收据，未确认的活跃调用标记为 `interrupted` 或 `unknown`，绝不伪造成功收据且流式 checkpoint 不以旧元数据覆盖已落定收据
