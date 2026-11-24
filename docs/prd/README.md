# Learn Pace PRD · V0.2

2026-11-24 · 拟议产品设计基线 · LF01 / LF02 · Android 优先

本目录按职责拆分 V0.1 与 V0.2 复评。保留 [V0.1 历史原稿](archive/Learn-Pace-PRD-v0.1.md)，历史原稿中的缺图描述是当时状态，不是 V0.2 当前结论。后续以本目录与 [V0.2 复评](../evaluation/learning-loop-review-v0.2.md) 为拟议基线，先评审待决项，再进入实施。无 App 功能已验收。

| 文档 | 内容 |
| --- | --- |
| [00](00-product-scope.md) | 产品目标及 P0 范围 |
| [01](01-information-architecture.md) | P00–P07 与 4 Tab |
| [02](02-page-layout-interaction.md) | 页面需求、交互、异常状态 |
| [03](03-lf01-exploration-flow.md) | LF01 |
| [04](04-lf02-mastery-flow.md) | LF02、状态机、评估、复习 |
| [05](05-domain-model.md) | 领域对象和身份关系 |
| [06](06-agent-runtime-contract.md) | Runtime 与 Domain 边界 |
| [07](07-data-flow.md) | 命令、回执、数据流 |
| [08](08-local-persistence.md) | 数据库、备份和恢复 |
| [09](09-acceptance-criteria.md) | AC-01–08 |

## 决策与来源

尚待冻结：4 Tab/场景入口确认、自报掌握、独立评估与复习失败策略、首期附件范围、Pi Durable Native PoC、许可证与未成年人隐私。详见 [实施路线](../roadmap.md) 和 [原型索引](../design/README.md)。

## 14. 参考来源与版本

业务基线为 Learn Pace README 已确认的 LF01/LF02 范围（提交 5984492a9300b7069ad17f4c027e2994087a2ef4）。下列源码链接固定至本次前序审查的上游引用，不声称已重新运行测试。

- [Learn Pace README](https://github.com/kms9/learn-pace/blob/5984492a9300b7069ad17f4c027e2994087a2ef4/README.md)
- [DeepTutor ChatWorkspace](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/features/chat/components/ChatWorkspace.tsx) · [Little Tutor threads](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/lib/session-threads.ts)
- [DeepTutor MasteryStudy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/web/components/space/learning/MasteryStudy.tsx) · [Mastery 模式](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/capabilities/mastery/mode.py) · [Learning Domain / tests](https://github.com/HKUDS/DeepTutor/tree/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning)
- [Learning Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/storage.py) · [Session Store](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/services/session/sqlite_store.py) · [Mastery Policy](https://github.com/HKUDS/DeepTutor/blob/1284116f92368480aef3a47f91b8df9e9b105062/deeptutor/learning/policy.py)
- [DeepTutor Lite Harness](https://github.com/leonyvon/deeptutor-lite/blob/5082b93f9317b8ec8264f3261b86af2b8b280683/src/agent/harness.ts) · [Cherry Studio Mobile](https://github.com/CherryHQ/cherry-studio-app/tree/14a0224fcdce482a36298a364799c52bb98a8ae8)
- 视觉依据：本对话已有的 12 张 Learn Pace UI 原型（附录 F01–F12，原始 PNG 随 Markdown 资产包提供）。以上来源为 V0.1 评审时的基线；当前 V0.2 仅同步产品设计，未执行 App 测试。
