# Tasks

## 1. 上游与设计验证
- [ ] 核对固定 Cherry 源码、D1/NOTICE、YAML/ZIP/hash 依赖与 Hermes 兼容；记录迁移映射。
- [ ] 用现有 Pi Durable + DeepSeek Flash 验证显式 instructions 及 list/load/read 的后续模型轮；测 token 与取消，确认不改变导航/题卡工具。
## 2. 包与持久化（packages/infra、packages/app-host）
- [ ] 实现 SkillPackage/SkillStorage port、严格 parser、manifest/digest、大小/路径/脚本兼容性、候选预览。
- [ ] 本地 SKILL.md、ZIP、公开 GitHub 固定 SHA 获取；测试不可信路径、压缩炸弹、恶意 YAML、同名异源、超限、取消。
- [ ] SQLite v5 后迁移、MemoryAppStore/ExpoAppStore/事务/快照实现，安装/更新/卸载/启用原子化；不写 domain。
## 3. 回合装配（packages/app-host、packages/runtime）
- [ ] TurnExtensionResolver、SkillScope、四个只读技能工具，限制 metadata、load/read 和 allowedTools。
- [ ] 修改 Lf01ChatService.prepare 主问答与小老师分支；选中版本 pin、消息 metadata receipt、失败提示、retry/recovery；无绑定时原逻辑不变。
- [ ] 加入工具权限、跨 scope、manual/model invocation、更新/停用并发、prompt injection 与取消测试。
## 4. 移动 UI（apps/mobile）
- [ ] 我的→技能列表/详情/导入预览/更新/卸载/启用与范围；不新增 Tab。
- [ ] composer 选择、可移除 chip、历史 receipt、工具不兼容提示；小老师保持返回/引用与会话恢复。
## 5. 备份与验收
- [ ] 扩展 DatabaseSnapshot/BackupRestoreService、v2校验及 v1兼容、预览、默认停用、大小上限、失败回滚；检查 credential 排除。
- [ ] 执行 corepack pnpm typecheck、corepack pnpm test、openspec validate --all --strict；运行现有 LF01/LF02/事务/恢复/备份回归。
- [ ] Android ARM64 真机：自定义教学 Skill 安装→显式选择→自动发现/加载→读取 reference→更新/停用→重启→备份恢复；无 Skill 普通对话与精通之路照常；记录 API/token/体积/时延。
- [ ] 主会话验收并 archive；再 propose m2c-ima-knowledge-lf01。不得提前勾选未验证任务。
