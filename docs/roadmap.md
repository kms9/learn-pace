# Learn Pace 实施路线（V0.2）

按 Gate 推进，不预估未经评审的工期。P0 范围仅 LF01/LF02。

已确认工程与产品基线（2026-11-24）：项目开源并获 Cherry Studio App 作者明确授权可直接复用其可用代码与设计；Agent Runtime 主选最新版 Pi Durable；首期模型仅需确保 DeepSeek Flash 接入（OpenAI-completions 兼容，支持 streaming / tool calling / JSON）；快速推进期暂不使用事务控制，完成主要业务流程后再补齐事务/CAS/幂等与恢复加固；P0 产品规则已冻结为 4 Tab、不做自报掌握、复习失败策略与 DeepTutor `scheduler` 一致、首期附件仅支持文本与选文。详见[可行性评估与实施方案](evaluation/feasibility-and-plan-v0.2.md)。

| 阶段 | 主要交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| M0 基线冻结 | 冻结 PRD V0.2、D1–D7 决策及 `packages/domain` 类型契约 | 需求→页面→命令→状态→验收可追踪；`packages/domain` 类型契约编译通过 |
| M1 技术验证 | Expo + 最新版 Pi Durable（复用 Cherry 适配）+ SQLite + DeepSeek Flash；Android ARM64 APK 与领域核心对照测试 | 真机完成问答→出题→落库→重启恢复原题→评分→UI 同步；领域核心与 DeepTutor 样本 100% 一致；给出 NFR-09 基准数字 |
| M2-A 主流程实现 | 快速推进 LF01/LF02 主流程、Learning Domain、DeepSeek Flash 评分与 P00–P07 核心 UI（暂不启用复杂事务控制） | LF01/LF02 主链路端到端可跑通，AC-01–04、AC-06 主路径验证通过 |
| M2-B 加固与恢复 | 补齐关键写入原子事务、Revision CAS、`submission_id` 幂等、作废重算、故障注入、可控时钟与备份恢复 | AC-01–07 自动化和人工测试全量通过，满足 NFR-02/03/04 |
| M3 MVP 交付 | Android 发布、安全、备份、性能与兼容；更多模型扩展与 iOS 视后续节奏推进 | AC-08 真机验收，无额外 Python/FastAPI 业务服务 |

当前：M0 收口与 M1 准备阶段，文档基线与工程决策已对齐，可搭建 monorepo 骨架并启动 M1 PoC；未完成工程实现。后续扩展多模型、课程包、资料解析/RAG、游戏、市场与跨设备同步，另行立项。

[PRD](prd/README.md) · [验收](prd/09-acceptance-criteria.md) · [闭环复评](evaluation/learning-loop-review-v0.2.md) · [可行性与实施方案](evaluation/feasibility-and-plan-v0.2.md)
