# Learn Pace · M2 OpenSpec 竖切规划（V0.2）

> 基线：M1（S1–S6）已全部真机通过（`7dce09c`、`c77ea75`；Release ARM64 APK 23.31 MiB、冷启动 214 ms、`pi-durable@1.6.0` 零补丁 + `pi-ai@1.6.0` 24 行补丁）。
> 原则：按垂直业务切片拆分 Change，**每次只 propose 并落地当前 Change**，真机验收并 archive 后再生成下一个 Change 的详细 specs/tasks，避免预写过多导致规格漂移。

## 一、M2-A · 双流程主流程快速实现（无事务控制版）

按决策 D3，M2-A 全部 Change 均采用顺序落库，**不引入** SQLite 事务控制、Revision CAS、严格 `submission_id` 幂等与故障注入对账（统一留到 M2-B）。首期模型仅需确保 **DeepSeek Flash** 接入（D5）。

| 顺序 | Change ID | 负责能力（Capabilities） | 覆盖页面 / 包 | 验收基线 | 当前状态 |
|---|---|---|---|---|---|
| **1** | `m2a-app-shell-and-storage` | `app-navigation`、`local-storage`、`model-settings` | P00、P07、4 Tab 骨架；`packages/infra`、`packages/app-host`、`apps/mobile` | 应用 4 Tab 可切、P00 场景可设可跳过、P07 DeepSeek Flash 可配置测试与重启保留、SQLite 全量核心表就绪 | **真机验收通过，[已归档](changes/archive/2026-11-24-m2a-app-shell-and-storage/)** |
| **2** | `m2a-lf01-chat-and-little-tutor` | `lf01-chat`、`little-tutor-threads` | P02 自由问答、Little Tutor 选文子会话、转目标入口；`packages/runtime`、`packages/app-host`、`apps/mobile` | **AC-01、AC-02**：多轮流式问答、取消、历史恢复、选文子会话保留锚点与主会话不变、一键带来源跳 P04 | 下一步，待 propose |
| **3** | `m2a-lf02-goal-and-outline` | `learning-path-outline` | P03 路径列表、P04 两步创建目标、P06 Outline 模式；`packages/domain`（DAG 校验）、`packages/app-host`、`apps/mobile` | **AC-03**：自定义目标与文本/选文来源创建、AI 生成大纲、先修 DAG 校验、预览确认后解锁 Study | Change 1 依赖已满足，待排期（可与 Change 2 弱并行） |
| **4** | `m2a-lf02-study-and-assessment` | `lf02-study-session`、`mastery-assessment` | P05 路径详情、P06 Study 工作台；`packages/domain`、`packages/runtime`、`packages/app-host`、`apps/mobile` | **AC-04**：`nextObjective` 驱动诊断/讲解/费曼/练习、选择题规则评分 + 概念/设计题 DeepSeek Flash 定性 Rubric 评分、提示曝光记录、掌握门禁推进 | 待 Change 3 完成后 propose |
| **5** | `m2a-lf02-review-loop` | `spaced-review-loop` | P06 Review 模式、P05 复习入口；`packages/domain`（`SpacedRepetitionScheduler`）、`packages/app-host`、`apps/mobile` | **AC-06**：到期队列、先独立检索再按需提示、答后反馈与保持风险/补救标记、复习结算与下次复习日期 | 待 Change 4 完成后 propose |
| **6** | `m2a-home-projections-and-polish` | `home-dashboard-projections` | P01 首页真实投影、P01/P03/P05/P06 跨页数值一致性、核心空态/加载态/错误态 | P01 统计与待答题卡优先恢复、跨页进度一致、主流程真机完整体验通过 | 待 Change 4 & 5 完成后 propose |

### 依赖关系图

```text
Change 1 (m2a-app-shell-and-storage)
   ├──► Change 2 (m2a-lf01-chat-and-little-tutor) ──────────────────┐
   └──► Change 3 (m2a-lf02-goal-and-outline)                        │
           └──► Change 4 (m2a-lf02-study-and-assessment)            │
                   └──► Change 5 (m2a-lf02-review-loop)             │
                           └──► Change 6 (m2a-home-projections) ◄───┘
```

---

## 二、M2-B · 一致性与恢复加固（M2-A 主流程跑通后再 propose）

| 顺序 | Change ID | 范围 | 验收基线 |
|---|---|---|---|
| **7** | `m2b-transactions-and-idempotency` | `CommitAssessment` / `CommitOutline` / `ReviseOutline` 原子短事务、Revision CAS、`submission_id` 幂等去重、题目异议与 `VoidAssessment` 作废重算 | NFR-02、NFR-03、AC-05 |
| **8** | `m2b-crash-recovery-and-clock` | 启动时异常状态对账（`interrupted` / `awaiting_input` / `answered` / `graded`）、Host 故障注入测试套件、可控时钟复习回归 | NFR-04、AC-05、AC-06 |
| **9** | `m2b-backup-and-restore` | 数据库一致性快照 + manifest 校验（默认不含凭据）、恢复预览、失败保留原数据 | AC-07 |

---

## 三、协作方式（配合 Herdr + Codex）
1. 在主会话评审当前 OpenSpec Change（`openspec/changes/<change-id>/` 下的 `proposal.md`、`specs/`、`design.md`、`tasks.md`）。
2. 确认无误后，让 Codex 按 `tasks.md` 逐项实施并跑通 `corepack pnpm typecheck`、`corepack pnpm test` 与 Android 真机检查。
3. 验收通过后归档该 Change（将 delta specs 同步进 `openspec/specs/`），再 propose 下一个 Change。
