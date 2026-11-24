# Learn Pace 实施路线（V0.2）

按 Gate 推进，不预估未经评审的工期。P0 范围仅 LF01/LF02。

| 阶段 | 主要交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| M0 基线冻结 | 确认 PRD V0.2、4 Tab、页面状态、学习策略、异常交互及证据/复习合同 | 需求→页面→命令→状态→验收可追踪；冻结待决项 |
| M1 技术验证 | Expo + Pi Durable 候选 Runtime + SQLite；Android ARM64 APK，外部模型及结构化题卡 | 真机完成问答→出题→落库→杀进程→恢复原题→评分→事务→UI 同步；确认依赖/许可 |
| M2 双流程实现 | LF01/LF02、Learning Domain、本地持久化与恢复 | AC-01–07 自动化和人工测试通过，故障注入、可控时钟、幂等与 CAS |
| M3 MVP 交付 | Android 发布、安全、备份、性能与兼容；iOS 视验证结果 | AC-08 真机验收，无额外 Python/FastAPI 业务服务 |

当前：M0 设计评审，已有主路径与关键状态原型，可开展 M1 PoC；未完成工程实现。后续扩展课程包、资料解析/RAG、游戏、市场与跨设备同步，另行立项。

[PRD](prd/README.md) · [验收](prd/09-acceptance-criteria.md) · [闭环复评](evaluation/learning-loop-review-v0.2.md)
