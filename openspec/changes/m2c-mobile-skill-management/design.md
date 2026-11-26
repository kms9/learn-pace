# Design

## Context
基线 2dd856d，PiDurableRuntime.registerTool / RuntimeTurnRequest.instructions / allowedTools 已可装配；ChatTurns.prepare 与 replyMetadata 是应用层扩展点。Cherry Mobile 的 Skill service、scope、tools 与 package validator 可迁移其语义。现有 AppStore/RestoreGate/DatabaseSnapshot 以 SQLite 为权威；不把 Pi MemoryStorage 当资产库。

## Decisions
1. Skill 是数据，非可执行插件。Host 管理能力，明确授权；模型只获得当前 scope，allowed-tools 仅表示依赖。禁止包脚本、任意本机文件/网络能力。
2. 采用 SkillStorage port + SQLite 有界包记录（skills/skill_revisions/skill_bindings），保持 revision 原子发布及备份一致性；使用 Cherry 内容哈希算法。路径、symlink、ZIP 解压限制、YAML、名称冲突检查；限制详见总体设计 §4。文件包导入/下载/验证在事务外，发布走 RestoreGate 和短事务，失败不影响旧版本。
3. 复用现有学习助手，不建多 Agent 系统；默认禁用，用户显式启用 LF01/小老师 scope。显式 composer 选择以结构化 metadata 保存；自动匹配 via list_local_skills/load_skill，引用 via list_skill_files/read_skill_file。显式正文 pre-injection，自动正文从受控 tool result 进入后续模型轮；按需加载不得改变应用指令优先级。
4. 每轮 pin revision 和 allowlist；运行中使用固定 snapshot，停用/卸载使新轮不可用并可取消活跃轮；retry/regenerate 复核原选择版本和权限，缺失时明确失败要求重选。实际 receipt 不等同于选择。自动工具调用有界（最多3个技能/24k字符合计；单引用8k字符及模型 token 预算）。
5. 现有 backup v1 严格校验七张表；v2 新增扩展结构和计数，兼容 v1，恢复前预览明确扩展覆盖，按旧 checksum 验证再升级 in-memory，校验所有 hash/FK/路径。默认恢复技能停用，历史保留，不会自动联网。仍保持20 MiB限制、排除真实凭据，恢复原子回滚。不得把任意新 credential settings 直接透传导出。
6. UI 沿用 4 Tab 与 Shell；我的新增技能子页面，问答 composer 可选，Dito 小老师保持父子会话和导航行为。只要无 Skill 就保持原 prompt/tools。模型不支持工具时仍可看包和普通聊天，明确提示不支持自动执行。

## Risks / Trade-offs
SQLite 包体上限低于 Cherry（避免单文件 JSON 备份膨胀），后续二进制大包需单独设计文件原子发布及备份。自动加载指令经工具结果进入模型，不假定与系统 prompt 完全等价，以真机测试判断；必要时只开显式 Skill 不发布自动模式。第三方包可能含提示注入或脚本；限制文件读取、工具授权、secret 隔离而非仅靠 prompt。未知工具仅展示未满足，不默认为能运行。新数据结构可能影响旧备份与删除逻辑，必须回归。详见总体方案。
