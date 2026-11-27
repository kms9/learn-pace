# mobile-skill-management Specification

## Purpose

定义移动端教学技能库的导入、校验、启用、更新与卸载规则，明确技能版本、使用场景和所需能力之间的边界，并保护学习数据与历史收据。

## Requirements

### Requirement: Validated user-controlled Skill installation
应用 SHALL 支持导入本地 `SKILL.md` / `.zip` 或公开 GitHub 来源（不依赖私有 token，GitHub MUST 固定 commit SHA，多候选需用户选定），并在安装前按实际原始字节完成标准 YAML、路径安全、manifest、`directory-sha256` 与容量校验，经预览确认后原子保存且默认停用。应用 MUST 拒绝路径穿越、symlink/submodule、路径碰撞、畸形 YAML、Shell 插值、压缩炸弹、超限及同名异源静默覆盖，且 MUST NOT 执行包内脚本。

#### Scenario: Install a valid custom teaching Skill
- **WHEN** 用户选择合法的本地 `SKILL.md`、`.zip` 或公开 GitHub Skill，并在预览核对名称、来源、版本、资源与兼容性后确认安装
- **THEN** 应用在事务外完成校验与 `directory-sha256` 计算，随后在短事务中原子保存技能元数据与修订版本（GitHub 来源保存固定 commit SHA）
- **AND** 新安装的 Skill 默认处于停用状态且不自动绑定任何学习场景，列表与详情立即可查看

#### Scenario: Reject malicious, colliding, or oversized package
- **WHEN** 导入包包含目录穿越、绝对路径、symlink、NFC 大小写路径碰撞、重复 YAML 键、Shell 插值、压缩炸弹、超出容量上限（单包 > 2 MiB、单文件 > 512 KiB、文件数 > 100、`SKILL.md` 正文 > 24,000 字符或全库原始文件字节 > 4 MiB），或与不同来源的已安装 Skill 同名
- **THEN** 应用拒绝安装并展示明确、可操作的拒绝原因，不产生部分安装记录，原有技能库与本地学习数据保持完全不变

#### Scenario: Cancel installation during preview or download
- **WHEN** 用户在 GitHub 拉取过程中取消或在预览确认页选择取消
- **THEN** 应用立即中止下载/解析流程且不向数据库写入任何技能记录

### Requirement: Library lifecycle and revision integrity
应用 SHALL 在「我的 → 技能」提供已安装列表、搜索、原始 `SKILL.md` 与文本资源详情查看、总开关与按流程作用域绑定（仅开放 `lf01` 与 `little_tutor`，不开放 `mastery`）、受控更新及卸载能力。每次更新 MUST 预览差异后原子切换 `active_revision`，且提交时 MUST 复查预览所依据的 `active_revision` 未变，已变则拒绝并要求重新预览；运行中回合 MUST 保持原固定 revision。停用或卸载 MUST 立即阻止后续新回合加载，回收未引用旧版本时 MUST 保留历史轻量收据且不删除任何学习资产。

#### Scenario: Update a skill while a turn is active
- **WHEN** 某问答回合正在使用 Skill 的旧 revision 时，用户对该 Skill 确认更新至新 revision
- **THEN** 运行中回合继续只读取已 pin 的旧 revision 直至结束，后续新回合使用经确认的新 revision
- **AND** 旧 revision 在不再被活跃回合引用后回收，历史消息中的旧 revision 收据不被改写

#### Scenario: Two update previews are confirmed one after another
- **WHEN** 用户针对同一 Skill 的同一 `active_revision` 先后打开两个更新预览（例如本地 ZIP 与 GitHub 新版本），先确认其中一个，再确认另一个
- **THEN** 第一次确认原子切换 `active_revision`；第二次确认因其依据的版本已过期而被拒绝，不写入任何内容，并提示「技能已被更新，请重新预览」

#### Scenario: Disable or uninstall a skill
- **WHEN** 用户停用某 Skill、取消其某作用域绑定，或在二次确认后卸载该 Skill
- **THEN** 后续新回合无法发现、选择或读取该 Skill；若卸载时仍有运行中回合，本地已 pin 版本允许安全结束或由用户取消
- **AND** 已有会话历史、收据展示与其他学习资产均保持完整

### Requirement: Mobile compatibility is separate from installation
应用 SHALL 在详情与预览中明确展示包内不可执行脚本、不支持的二进制资源与 Host 可信目录中缺失的工具（首期不探测模型工具调用能力），清晰区分「已安装」「已启用」「当前场景可用」「依赖未满足」四个维度。应用 MUST NOT 因 Skill 在 Frontmatter 中声明 `allowed-tools` 或 `compatibility` 而授予任何新能力或隐藏限制。

#### Scenario: A package contains scripts or unsupported binaries
- **WHEN** 用户预览或查看包含 Node/Python/Shell 脚本或二进制文件的合法 Skill 包
- **THEN** 应用允许将其作为不可执行资料保留，并在详情中明确提示移动端不执行脚本、模型不可读取二进制或执行脚本
- **AND** 缺少所需能力时不得将安装成功展示为可执行或流程成功

### Requirement: Independent package, scope and tool eligibility
应用 SHALL 独立维护包有效性、作用域启用状态与 Host 可信能力就绪态。任何 Skill 的名称、`origin`、`metadata`、`allowed-tools` 或指令正文均 MUST NOT 注册新工具、创建外部连接、获取凭据或冒充内置连接器。`user-invocable=false` 与 `disable-model-invocation=true` 两个调用标志 SHALL 各自独立生效，不得经由另一入口绕过。

#### Scenario: Imported package claims an unregistered or privileged capability
- **WHEN** 合法导入的 Skill 在 `allowed-tools` 或元数据中声明了未在 Host 可信目录注册的能力或内置连接器名称
- **THEN** 安装不会授予该能力，详情界面将其就绪态标为「依赖未满足」，且模型在任何回合中均无法调用该能力

#### Scenario: Explicit and automatic invocation flags remain independent
- **WHEN** 某 Skill 声明 `user-invocable: false` 或 `disable-model-invocation: true`
- **THEN** `user-invocable: false` 的 Skill 不出现在输入框显式技能菜单中；`disable-model-invocation: true` 的 Skill 不进入模型自动发现清单与 `list_local_skills` 结果中，且两者互不扩大对方权限
