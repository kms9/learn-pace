# Learn Pace PRD · V0.2

2026-11-24 · 拟议产品设计基线 · LF01 / LF02 · Android 优先

本目录按职责拆分 V0.1 与 V0.2 复评。保留 [V0.1 历史原稿](archive/Learn-Pace-PRD-v0.1.md)，历史原稿中的缺图描述是当时状态，不是 V0.2 当前结论。后续以本目录与 [V0.2 复评](../evaluation/learning-loop-review-v0.2.md) 为拟议基线，先评审待决项，再进入实施。无 App 功能已验收。

**V0.3 方向（2026-11-25 确认）**：产品目标调整为「打开应用即是 DeepTutor 的手机版」。问答与精通之路两条流程的交互结构、导师行为、术语和视觉对齐 DeepTutor `1284116`，本地优先、DeepSeek Flash 与 Android 的工程边界不变。01、02、03、04、06、07、09 已按[DeepTutor 手机版复刻方案](../evaluation/deeptutor-mobile-parity-plan-v0.3.md)更新；与本方案冲突的 V0.2 原型（D03–D07、D09、D10 等）仅作视觉历史参考。

| 文档 | 内容 |
| --- | --- |
| [00](00-product-scope.md) | 产品目标及 P0 范围 |
| [01](01-information-architecture.md) | P01–P07 与 4 Tab（学习 / 问答 / 精通之路 / 我的） |
| [02](02-page-layout-interaction.md) | 页面需求、精通会话三种模式、异常状态 |
| [03](03-lf01-exploration-flow.md) | LF01 问答与小老师 |
| [04](04-lf02-mastery-flow.md) | LF02 精通之路、状态、评估、复习 |
| [05](05-domain-model.md) | 领域对象和身份关系 |
| [06](06-agent-runtime-contract.md) | Runtime 与 Domain 边界 |
| [07](07-data-flow.md) | 命令、回执、数据流 |
| [08](08-local-persistence.md) | 数据库、备份和恢复 |
| [09](09-acceptance-criteria.md) | AC-01–08 |
| [10](10-mobile-skills-and-ima-knowledge.md) | V0.4 M2-C：Skill 管理、Runtime、ima 知识库、LF01/LF02 集成与 AC-M2C 验收 |

**V0.4 增量（2026-11-26，待评审）**：新增 [M2-C 产品需求文档](10-mobile-skills-and-ima-knowledge.md)，将 Skill 管理与 ima 作为首个外部知识库扩展纳入 P1；保留 P0 原规则与 AC-01–08，不提前 propose Change 11/12。产品需求见 PRD 10，架构见 [V0.4 技术方案](../evaluation/mobile-skill-ima-extension-plan-v0.4.md)，当前实施见 [OpenSpec 路线](../../openspec/ROADMAP.md)。历史 V0.2 状态描述不代表最新代码状态；实施进展以归档与路线为准。

## 决策与来源

- **已确认工程决策（2026-11-24）**：项目开源并获 Cherry Studio App 作者明确授权，可直接复用/参考其可用代码与设计；Agent Runtime 主选最新版 Pi Durable；首期模型仅需确保接入 DeepSeek Flash（OpenAI-completions 兼容，支持 streaming / tool calling / JSON）；快速推进期先不使用事务控制，完成 LF01/LF02 主流程后再补齐事务/CAS/幂等与恢复加固。详见[可行性评估与实施方案](../evaluation/feasibility-and-plan-v0.2.md)。
- **已冻结 P0 产品规则（2026-11-24，2026-11-25 修订）**：采用 4 Tab 导航（学习 / 问答 / 精通之路 / 我的），默认打开「问答」；不设学习场景选择（原 P00 移除）；与 DeepTutor 一致提供自报掌握，来源与系统评估分开显示、不产生测评证据；复习作答与学习作答走同一评分管线，复习独立答错使掌握回落、回到学习补救（与 DeepTutor 评分与调度一致）；首期附件仅支持文本与选文。公开面向未成年人上线前另行评估隐私合规。详见[复刻方案 §2.3](../evaluation/deeptutor-mobile-parity-plan-v0.3.md)、[实施路线](../roadmap.md)和[原型索引](../design/README.md)。

## 14. 参考来源与版本

业务基线为 Learn Pace README 已确认的 LF01/LF02 范围。下列源码链接固定至与 `.gitmodules` 一致的上游提交，不声称已重新运行测试。

- [Learn Pace README](../../README.md)
- [DeepTutor ChatWorkspace](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/features/chat/components/ChatWorkspace.tsx) · [Little Tutor threads](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/lib/session-threads.ts)
- [DeepTutor MasteryStudy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/components/space/learning/MasteryStudy.tsx) · [Mastery 模式](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/capabilities/mastery/mode.py) · [Learning Domain / tests](https://github.com/HKUDS/DeepTutor/tree/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning)
- [Learning Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/storage.py) · [Session Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/services/session/sqlite_store.py) · [Mastery Policy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/policy.py)
- [DeepTutor Lite Harness](https://github.com/leonyvon/deeptutor-lite/blob/5082b93f9317b8ec8264f3261b86af2b8b280683/src/agent/harness.ts) · [Cherry Studio Mobile](https://github.com/CherryHQ/cherry-studio-app/tree/14a0224fcdce482a36298a364799c52bb98a8ae8)
- 视觉依据：V0.1 12 张原图（`docs/design/v0.1/images/`）与 V0.2 12 组 / 41 状态原型（`docs/design/v0.2/`，含 `prototype.html`、`boards/`、`screens/`），共 66 项文件通过 [assets.sha256](../design/assets.sha256) 校验。当前仅同步产品与工程设计基线，尚未执行 App 测试。
