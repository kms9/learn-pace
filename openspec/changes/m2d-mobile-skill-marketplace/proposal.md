# Proposal

## Why

移动技能库已有本地和 GitHub 导入。学习者还需要在应用内发现教学 Skill，并从可信的版本入口安装和更新。

## What Changes

- 在「我的 → 技能 → 技能市场」默认打开 DeepTutor 官方 EduHub，支持浏览、搜索、查看详情和预览安装。
- 以相同的预览和确认流程支持腾讯 SkillHub 与 ClawHub。保留公开 GitHub 和本地文件入口。
- 保存市场来源、发布者、精确版本和包摘要，支持从原来源查看更新。移动端展示平台依赖与兼容状态。

## Capabilities

### New Capabilities

- `mobile-skill-marketplace`：默认教学技能市场、多来源发现、固定版本获取与安装预览。

### Modified Capabilities

- `mobile-skill-management`：市场包与既有导入共用校验、安装、启用及更新语义。
- `local-storage`：升级技能来源约束并保留现有学习数据。
- `local-backup-restore`：备份和恢复市场安装来源，以及兼容既有备份版本。

## Impact

- Android 技能管理、`packages/app-host` 技能服务、`packages/infra` SQLite 与备份。
- EduHub、SkillHub 和 ClawHub 的公开只读 HTTP API。

## Non-Goals

- 市场账号、私有包、发布、任意第三方服务器配置和包内脚本执行属于独立需求。
- DeepTutor Lite 教学包改写与知识库接入精通之路沿用各自的后续工作。
