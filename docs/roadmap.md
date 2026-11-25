# Learn Pace 实施路线（V0.3）

按 Gate 推进，不预估未经评审的工期。P0 范围仅 LF01/LF02。

已确认工程与产品基线（2026-11-24）：项目开源并获 Cherry Studio App 作者明确授权可直接复用其可用代码与设计；Agent Runtime 主选最新版 Pi Durable；首期模型仅需确保 DeepSeek Flash 接入（OpenAI-completions 兼容，支持 streaming / tool calling / JSON）；快速推进期暂不使用事务控制，完成主要业务流程后再补齐事务/CAS/幂等与恢复加固；首期附件仅支持文本与选文。详见[可行性评估与实施方案](evaluation/feasibility-and-plan-v0.2.md)。

**V0.3 方向（2026-11-25）**：产品目标调整为「打开应用即是 DeepTutor 的手机版」。LF02 从页面工作台改为导师驱动的精通会话；4 Tab 改为「学习 / 问答 / 精通之路 / 我的」并默认打开「问答」；移除学习场景选择；提供自报掌握；复习在会话中进行，不设结算页；已确认大纲可在 M2-A 修订。详见[DeepTutor 手机版复刻方案](evaluation/deeptutor-mobile-parity-plan-v0.3.md)。

| 阶段 | 主要交付 | 进入下一阶段的门槛 |
| --- | --- | --- |
| M0 基线冻结 | 冻结 PRD V0.2、D1–D7 决策及 `packages/domain` 类型契约 | 已完成 |
| M1 技术验证 | Expo + 最新版 Pi Durable + SQLite + DeepSeek Flash；Android ARM64 APK 与领域核心对照测试 | 已完成（S1–S6 真机通过） |
| S7 导师循环验证 | 移植 `mastery_status`、`mastery_build`、`mastery_quiz`、`mastery_grade`、`mastery_mode` 与精简中文导师提示词，在 Android 真机用 DeepSeek Flash 跑通「建大纲 → 讲解 → 出题 → 批改」 | 10 次以上完整循环中工具名与参数合法率、出题收尾正确率、首字延迟与单轮 token 成本达到验证前约定的阈值；不通过则评审「Host 决定工具调用」的备选方案 |
| M2-A 主流程实现 | 问答与小老师、精通之路列表与向导、精通会话（编辑大纲 / 学习 / 复习）、题卡与评分、路径页、学习首页与 DeepTutor 视觉文案（暂不启用复杂事务控制） | LF01/LF02 主链路端到端可跑通，AC-01–04、AC-06 主路径验证通过 |
| M2-B 加固与恢复 | 补齐关键写入原子事务、大纲版本 CAS、`submission_id` 幂等、作废重算、故障注入、可控时钟与备份恢复 | AC-01–07 自动化和人工测试全量通过，满足 NFR-02/03/04 |
| M3 MVP 交付 | Android 发布、安全、备份、性能与兼容；更多模型扩展与 iOS 视后续节奏推进 | AC-08 真机验收，无额外 Python/FastAPI 业务服务 |

当前：M2-A Change 1（应用壳与存储）已归档；PRD 已按 V0.3 方向更新，OpenSpec Change 2–6 待按复刻方案修订或重写。后续扩展多模型、课程包、资料解析/RAG、DeepTutor 其他学习形态、市场与跨设备同步，另行立项。

[PRD](prd/README.md) · [验收](prd/09-acceptance-criteria.md) · [复刻方案](evaluation/deeptutor-mobile-parity-plan-v0.3.md) · [源码对照](evaluation/deeptutor-learn-pace-source-comparison-v0.2.md) · [可行性与实施方案](evaluation/feasibility-and-plan-v0.2.md)
