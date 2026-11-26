# Learn Pace · M2 OpenSpec 竖切规划（V0.3）

> 基线：M1（S1–S6）已全部真机通过（`7dce09c`、`c77ea75`；Release ARM64 APK 23.31 MiB、冷启动 214 ms、`pi-durable@1.6.0` 零补丁 + `pi-ai@1.6.0` 24 行补丁）。
> 原则：按垂直业务切片拆分 Change，**每次只 propose 并落地当前 Change**，真机验收并 archive 后再生成下一个 Change 的详细 specs/tasks，避免预写过多导致规格漂移。
> 方向（2026-11-25）：以「打开应用即是 DeepTutor 的手机版」为目标，按 [DeepTutor 手机版复刻方案](../docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md) 调整 Change 2–6。PRD、路线图与下表各 Change 的规格均已按方案更新（`openspec validate --all --strict` 通过）；Change 3′–6′ 实施前仍以 S7 结论复核。

## 一、M2-A · 双流程主流程快速实现（无事务控制版）

按决策 D3，M2-A 全部 Change 均采用顺序落库，**不引入** SQLite 事务控制、大纲版本 CAS、严格 `submission_id` 幂等与故障注入对账（统一留到 M2-B）。首期模型仅需确保 **DeepSeek Flash** 接入（D5）。

| 顺序 | Change ID | 负责能力（Capabilities） | 覆盖页面 / 包 | 验收基线 | 当前状态 |
|---|---|---|---|---|---|
| **1** | `m2a-app-shell-and-storage` | `app-navigation`、`local-storage`、`model-settings` | P00、P07、4 Tab 骨架；`packages/infra`、`packages/app-host`、`apps/mobile` | 应用 4 Tab 可切、P00 场景可设可跳过、P07 DeepSeek Flash 可配置测试与重启保留、SQLite 全量核心表就绪 | **真机验收通过，[已归档](changes/archive/2026-11-24-m2a-app-shell-and-storage/)**；Tab 改名、默认页与移除 P00 由 Change 2 以 MODIFIED / REMOVED 提交 |
| **S7** | 技术验证（不建 Change） | 导师多工具循环 | `packages/runtime`、`packages/app-host`、`apps/mobile` 调试页 | DeepSeek Flash 在真机稳定驱动 `mastery_status` / `build` / `quiz` / `grade` / `mode` | **通过（GO）**，[验收报告](../docs/evaluation/s7-tutor-loop-verification-report.md) |
| **2** | `m2a-lf01-chat-and-little-tutor` | `lf01-chat`、`little-tutor-threads`、`app-visual-identity`；修改 `app-navigation`、`model-settings`、`local-storage` | P02 问答、小老师侧聊、添加到对话框、转为学习目标；4 Tab 改名与默认「问答」、移除 P00、DeepTutor 主题与文案、Markdown/公式渲染 | **AC-01、AC-02** | **真机验收通过，[已归档](changes/archive/2026-11-25-m2a-lf01-chat-and-little-tutor/)** |
| **3′** | `m2a-mastery-topics-and-outline`（替代 `m2a-lf02-goal-and-outline`） | `mastery-topics`、`mastery-session`、`mastery-outline` | 精通之路列表、新建向导、路径页基础版、精通会话骨架与编辑大纲模式；`interactions` 支持 `abandoned` | **AC-03** | **AC-03 真机验收通过，[已归档](changes/archive/2026-11-25-m2a-mastery-topics-and-outline/)** |
| **4′** | `m2a-mastery-study-session`（替代 `m2a-lf02-study-and-assessment`） | `mastery-question-cards`、`mastery-assessment`、`mastery-study-mode`、`mastery-objective-evidence` | 学习模式、题卡、评分管线与语义判定、作废与更正、自报掌握、证据抽屉、升级庆祝 | **AC-04** | **AC-04 真机验收通过，[已归档](changes/archive/2026-11-25-m2a-mastery-study-session/)** |
| **5′** | `m2a-mastery-review`（替代 `m2a-lf02-review-loop`） | `mastery-review` | 复习模式、复习入口与开场消息、复习计划面板、开发时钟 | **AC-06** | **AC-06 真机验收通过，[已归档](changes/archive/2026-11-25-m2a-mastery-review/)** |
| **6′** | `m2a-learning-home-and-shell`（替代 `m2a-home-projections-and-polish`） | `learning-home`、`mastery-handoff`；修改 `lf01-chat` | 学习首页、聊天交接卡、跨页一致、全链路走查 | M2-A 里程碑 | **M2-A 全链路真机走查通过，[已归档](changes/archive/2026-11-25-m2a-learning-home-and-shell/)** |

### 依赖关系图

```text
Change 1 (m2a-app-shell-and-storage, 已归档)
   ├──► Change 2 (m2a-lf01-chat-and-little-tutor, 修订) ─────────────┐
   └──► S7 导师循环验证                                              │
           └──► Change 3′ (m2a-mastery-topics-and-outline)           │
                   └──► Change 4′ (m2a-mastery-study-session)        │
                           └──► Change 5′ (m2a-mastery-review)       │
                                   └──► Change 6′ (learning-home) ◄──┘
```

Change 2 的 runtime `instructions` / `history`、消息状态规则与 `MessageContent` 渲染组件被 Change 3′ 起的精通会话复用；聊天中的交接卡需要路径与会话存在，放在 Change 6′。Change 6′ 对 `lf01-chat` 的修改要求 Change 2 先归档。

### 评审决议

**2026-11-25（第一轮）**
- **复习失败口径**：复习作答与学习作答走同一评分管线（移植 DeepTutor `_apply_grade` / `record_qualitative_in_memory`），复习独立答错会记录失误与错因、掌握度回落、知识点回到学习中、已完成路径回到学习中；重新达标即补救完成，知识点带失误历史回到复习计划。已写入 PRD 04 §6.3。
- **调度起点**：与上游一致，从首次评分起维护复习状态；复习计划只显示已掌握知识点。
- **待排期项**：LF01-05「可选理解验证」，后续参照 DeepTutor「主动提问」实现，不计入掌握度。

**2026-11-25（第二轮，复刻方向）**：4 Tab 改为「学习 / 问答 / 精通之路 / 我的」并默认打开「问答」；先修关系不强制拦截；删除题卡提示按钮与复习结算页；已确认大纲在 M2-A 可修订；加入自报掌握；移除 P00 学习场景。详见[复刻方案 §2.3](../docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md)。

---

## 二、M2-B · 一致性与恢复加固（M2-A 主流程跑通后再 propose）

| 顺序 | Change ID | 范围 | 验收基线 |
|---|---|---|---|
| **7** | `m2b-transactions-and-idempotency` | 评分写入与大纲修订提交的原子短事务、大纲版本 CAS、`submission_id` 幂等去重、`mastery_repair_question` 作废重算的事务化 | NFR-02、NFR-03、AC-05 |
| **8** | `m2b-crash-recovery-and-clock` | 启动时异常状态对账（`interrupted` / `awaiting_input` / `answered` / `graded`）、Host 故障注入测试套件、可控时钟复习回归 | NFR-04、AC-05、AC-06 |
| **9** | `m2b-backup-and-restore` | 数据库一致性快照 + manifest 校验（默认不含凭据）、恢复预览、失败保留原数据 | AC-07 |

---

## 三、M2-C · 可选 Skill 与外部知识库扩展（待评审）
基于当前 M2-A/M2-B 代码与归档，不改变 P0 学习闭环；参见 [移动端 Skill 与 ima 扩展设计 V0.4](../docs/evaluation/mobile-skill-ima-extension-plan-v0.4.md)。

| 顺序 | Change ID | 范围 | Gate |
|---|---|---|---|
| 10 | [m2c-mobile-skill-management](changes/m2c-mobile-skill-management/proposal.md) | 移动端 Skill 导入/管理/作用域/按需加载、LF01、小老师、备份安全 | 自定义教学 Skill 真机闭环 + 原 M2-B 回归 |
| 11 | m2c-ima-knowledge-lf01 | 通用 KnowledgeProvider、ima 只读连接/检索/原文/引用、移动兼容 Skill | 真实库真机验证、无独立业务后端、无凭据泄漏 |
| 12 | m2c-knowledge-mastery | 路径资料绑定、Outline/Study/Review | 资料证据与学习证据分离，原评分/复习/恢复门禁不退化 |

仅第10项 propose 详细 change；第11/12项待前一项验收归档后再生成 specs/tasks。不引入市场、脚本执行器、云同步或本地重型 RAG。

---

## 四、协作方式（配合 Herdr + Codex）
1. 在主会话评审当前 OpenSpec Change（`openspec/changes/<change-id>/` 下的 `proposal.md`、`specs/`、`design.md`、`tasks.md`）。
2. 确认无误后，让 Codex 按 `tasks.md` 逐项实施并跑通 `corepack pnpm typecheck`、`corepack pnpm test` 与 Android 真机检查。
3. 验收通过后归档该 Change（将 delta specs 同步进 `openspec/specs/`），再 propose 下一个 Change。
