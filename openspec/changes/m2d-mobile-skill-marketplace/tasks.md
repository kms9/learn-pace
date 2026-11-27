# Tasks

## 1. EduHub 默认市场和共用安装面

- [x] 1.1 在 `packages/app-host` 和 `apps/mobile` 接入 EduHub 目录、搜索、版本校验和安装预览。验证真实 Socratic Tutor 的文件摘要与固定版本。
- [x] 1.2 在 `packages/infra` 和 `packages/app-host` 持久化市场来源，支持同源更新、SQLite v8→v9 和历史备份恢复。使用 `corepack pnpm test` 验证迁移与备份。

## 2. 其他公开来源

- [x] 2.1 扩展 Host 市场服务支持 SkillHub 固定版本清单与对象存储 ZIP。用真实 ZIP、校验不符和重定向拒绝用例验证。
- [x] 2.2 接入 ClawHub 发布者、固定版本 ZIP 和 GitHub 转交，解析 OpenClaw 依赖。验证真实 ZIP 与模拟转交、缺依赖和不通过的包。

## 3. 验证

- [x] 3.1 运行 `corepack pnpm typecheck`、`corepack pnpm test` 和 `openspec validate --all --strict`。在 Android 确认默认市场入口、预览、取消与确认安装，可访问现有本地和 GitHub 导入。
