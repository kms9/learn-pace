# Proposal

## Why
当前 LF01/LF02 已有运行时与本地业务闭环。教学指令仍硬编码，缺少可维护的 Skill 生命周期；后续需用 ima 验证外部知识来源接入。参考 Cherry Studio Mobile 固定子模块，先建立通用、移动端安全的 Skill 管理和回合装配，再接入第一个 provider。产品范围与需求 ID（SKM/SKR、EXT-NFR、AC-M2C-10）见 [PRD 10](../../../docs/prd/10-mobile-skills-and-ima-knowledge.md)；详见 [M2-C 设计](../../../docs/evaluation/mobile-skill-ima-extension-plan-v0.4.md)。

## What Changes
- 「我的→技能」：导入 SKILL.md / ZIP / 公开 GitHub 链接、预览/安装/更新/卸载、详情与兼容性、启用与流程绑定。
- Host 解析本轮授权 scope，显式选择与按需发现、load、清单/文本资源读取；仅复用现有 PiDurableRuntime 和白名单。
- 新增有界版本包持久化、回合选择/执行收据、备份 v2（可恢复 v1）、恢复默认停用，保护现有 M2-B 数据一致性。
- 以自定义教学 Skill 和无外部密钥的 mock/reference 验证 LF01、小老师及普通聊天回归。

### Non-Goals / Out of Scope
不做 ima 网络连接（第11项），不做 LF02 扩展（第12项），不执行包脚本/通用 HTTP/动态代码，不做市场/Agent CRUD/MCP/云同步，不改变学习领域、题卡与评分逻辑，不承诺任意 Skill 可执行。

## Capabilities
### New Capabilities
- `mobile-skill-management`：包获取、校验、版本、管理、兼容性与 scope。
- `skill-turn-runtime`：按需加载、显式选择、工具权限、回合收据。
### Modified Capabilities
- `local-backup-restore`：扩展包及绑定的备份兼容与无损恢复。

## Impact
packages/app-host、packages/infra、packages/runtime（仅必要契约调整）、apps/mobile；domain 不变。依赖评估 YAML/ZIP/Expo digest，不使用 Node fs/path/process 或新增脚本执行器。先审查 D1/NOTICE，验证 Android ARM64 与 DeepSeek Flash。提案尚未实施/验收。
