# Spec Delta

## Purpose

定义移动端面向学习者的公开技能市场，覆盖 DeepTutor 官方 EduHub 的默认浏览入口，以及从其他受支持的市场发现技能、校验固定版本并导入本地技能库。

## ADDED Requirements

### Requirement: EduHub is the default mobile marketplace
「我的 → 技能 → 技能市场」 SHALL 默认打开 DeepTutor 官方 EduHub。应用 SHALL 支持浏览、搜索、显示发布者和版本，以及切换至腾讯 SkillHub 和 ClawHub。每个来源的空结果、限流和下载失败 SHALL 显示对应反馈，用户可重试或切换来源。

#### Scenario: Browse and search public teaching skills
- **WHEN** 用户首次打开市场，随后搜索教学技能并切换来源
- **THEN** 应用先展示 EduHub 的公开目录，各来源按当前查询独立展示结果，并标注来源、发布者或可用的来源信息以及版本

### Requirement: Marketplace installation pins publisher and version
应用 MUST 在获取包前解析公开来源、发布者、包标识与精确版本，并校验来源提供的文件完整性信息。EduHub 和 ClawHub 被标记不通过的包 MUST 被拒绝。市场安装 SHALL 复用本地安装预览，显示缺失能力和待验证的第三方兼容性。下载取消、预览取消或完整性失败 MUST 无持久化写入。

#### Scenario: Install an EduHub skill and retain its origin
- **WHEN** 用户在 EduHub 选中公开教学技能，并确认安装已校验的固定版本
- **THEN** 本地技能显示准确的市场来源与版本，并默认停用，用户可手动启用并绑定到问答或 Dito

#### Scenario: Download SkillHub or resolve a ClawHub GitHub-backed skill
- **WHEN** 用户选择一个 SkillHub ZIP，或 ClawHub 返回带固定公开提交和路径的包来源
- **THEN** 应用仅通过受支持来源获取文件并校验清单摘要，再展示同一安装预览

#### Scenario: Platform metadata does not grant runtime capabilities
- **WHEN** 第三方包声明其他平台的系统、命令行、安装器或环境要求
- **THEN** 预览清楚标记移动端未满足的依赖，相关要求不能授予回合执行能力

#### Scenario: Wrong publisher or modified artifact cannot be installed
- **WHEN** 版本校验的发布者、包标识或版本与所选项不符，安全审核未通过，或下载文件与清单不一致
- **THEN** 应用展示失败原因，不写入本地技能库
