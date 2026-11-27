# Spec Delta

## MODIFIED Requirements

### Requirement: Validated user-controlled Skill installation
应用 SHALL 支持导入本地 `SKILL.md` / `.zip` 、公开 GitHub 或受支持的公开技能市场（GitHub MUST 固定 commit SHA，市场 MUST 固定发布者与版本，多候选需用户选定），并在安装前按实际原始字节完成标准 YAML、路径安全、manifest、`directory-sha256` 与容量校验，经预览确认后原子保存且默认停用。应用 MUST 拒绝路径穿越、symlink/submodule、路径碰撞、畸形 YAML、Shell 插值、压缩炸弹、超限及同名异源静默覆盖，且 MUST NOT 执行包内脚本。

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

#### Scenario: Update a skill from the same marketplace publisher
- **WHEN** 用户在已安装市场技能中检查更新
- **THEN** 应用按原市场与发布者解析新版并预览差异。同名异源包无法静默覆盖，运行中的回合继续使用其原固定版本
