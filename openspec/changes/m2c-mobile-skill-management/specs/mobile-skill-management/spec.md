# mobile-skill-management Specification

## ADDED Requirements

### Requirement: Validated user-controlled Skill installation
应用 SHALL 从本地 SKILL.md、ZIP 或公开 GitHub 精确来源获取包，解析标准 YAML，验证名称、描述、manifest、哈希、路径与大小；GitHub SHALL pin commit；安装前明确预览并由用户确认。MUST 拒绝越界路径、symlink/submodule、碰撞、恶意/无效 YAML、超限及同名异源替换。不得执行包内脚本。

#### Scenario: Install a valid custom teaching Skill
- **WHEN** 用户预览并确认合法的技能包
- **THEN** 应用原子保存版本及元数据，显示详情和兼容性，默认不启用

#### Scenario: Reject malicious or oversized package
- **WHEN** 包包含目录穿越、重复键、超限展开字节或不合法名称
- **THEN** 应用拒绝安装，旧包与业务数据保持不变

### Requirement: Library lifecycle and revision integrity
应用 SHALL 提供列表、详情、启用/停用、按流程绑定、更新和卸载。每轮固定已授权 revision；更新 MUST 原子切换版本，旧历史收据不可改写。删除仅影响本地包和绑定。

#### Scenario: Update a skill while a turn is active
- **WHEN** 用户更新一个正在使用的 Skill
- **THEN** 当前轮只使用原 revision，下一轮使用经确认的新 revision；旧版本不可用时重试提示重选

#### Scenario: Disabled skill cannot be invoked
- **WHEN** 用户停用或卸载 Skill
- **THEN** 后续轮不再发现或读取该 Skill，已有历史仍可查看

### Requirement: Mobile compatibility is separate from installation
应用 SHALL 展示脚本不可执行、缺少工具/运行环境等限制。MUST NOT 由于 Skill 声明 allowed-tools 而授予任何新权限。

#### Scenario: A package requires an unavailable Node script
- **WHEN** 用户查看或选择含 Node 脚本的 Skill
- **THEN** 应用提示只能阅读而不能执行，缺少能力时不得声称流程已成功
