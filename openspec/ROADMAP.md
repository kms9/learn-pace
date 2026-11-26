# Learn Pace · OpenSpec 竖切规划（V0.4）

> 基线：M1（S1–S6，`c77ea75`）、S7 导师循环（`GO`）、M2-A 全部 6 个 Change + 两轮移动体验打磨（`refine-mobile-learning-experience`、`m2a-mobile-ux-polish`）以及 M2-B 全部 3 个加固 Change（Change 7–9）均已完成并归档。
> 方向（2026-11-26 · V0.4）：在过完 **M3（AC-08）真机发布门禁并锁定 Release 基线** 后，进入 **M2-C（V0.4）**：聚焦本地复习提醒、问答自测（LF01-05）、错题回看与轻量知识卡；语音输入交由系统中文输入法，多源资料输入继续按 D7 冻结待专项调研。

## 一、已完成里程碑（M2-A & M2-B · 全部归档）

| 阶段 | Change ID | 核心能力 | 状态 |
| --- | --- | --- | --- |
| **M2-A** | `m2a-app-shell-and-storage`、`m2a-lf01-chat-and-little-tutor`、`m2a-mastery-topics-and-outline`、`m2a-mastery-study-session`、`m2a-mastery-review`、`m2a-learning-home-and-shell` | 4 Tab 壳体与 SQLite、问答与小老师、精通之路（大纲/学习/复习三模式）、学习首页与聊天交接卡 | ✅ 全部归档 |
| **M2-A 打磨** | `refine-mobile-learning-experience`、`m2a-mobile-ux-polish` | 原生渲染选区、题卡焦点提交栏、搜索、4 Tab 图标、减噪重排、工具实时进度与证据弹层 | ✅ 全部归档 |
| **M2-B** | `m2b-transactions-and-idempotency`（7）、`m2b-crash-recovery-and-clock`（8）、`m2b-backup-and-restore`（9） | SQLite v5 事务与写入队列、统一 CAS 与幂等、冷启动全局与题组对账、故障注入与时钟回归、7 表一致快照备份与原子恢复 | ✅ 全部归档 |

---

## 二、阶段 0：M3 发布基线与 V0.4 范围决策（进入 M2-C 前置）

1. **M3（AC-08）真机发布验收已完成**。在 Android ARM64 真机（`86ceabbf`）完成 AC-01–08 走查。Release APK 为 38,843,754 字节，冷启动中位数为 225 ms。后续新增原生模块以此为比较基线。[真机记录](../apps/mobile/README.md)
2. **V0.4 范围决策表（已同步至 PRD `00 / 03 / 08 / 09` 与 `openspec/config.yaml` D9）**：
   - 本地复习提醒：纳入（Change 10，`expo-notifications`）；
   - 问答自测（LF01-05）：纳入（Change 11，Host 直接 JSON 生成，存入 `messages.metadata`，零掌握度副作用）；
   - 笔记本能力：局部放开（Change 12，只做只读错题回看 + `knowledge_cards` 轻量知识卡，不做重型编辑器）；
   - 语音作答：不自研，依托 Android 系统中文输入法（讯飞/搜狗等），验收时实测；
   - 多源资料（PDF/识图/网页）：继续按 D7 冻结，待专项调研后再规划。

---

## 三、M2-C · V0.4 留存、自测与资产沉淀（Change 10–12）

| 顺序 | Change ID | 负责能力（Capabilities） | 覆盖范围 | 验收基线 | 当前状态 |
| --- | --- | --- | --- | --- | --- |
| **10** | `m2c-review-reminders` | `review-reminders` | `packages/domain` 纯排程函数、`packages/app-host` 提醒服务、`apps/mobile` `expo-notifications` + 通知渠道 + 深链跳转 +「我的」提醒设置 | **AC-09** | M3 已通过，可实施 |
| **11** | `m2c-chat-quick-check` | `chat-quick-check` | 小验证脚本（DeepSeek Flash JSON 出题）、Host 直接出题与评分（复用 `semantic-assessment`）、消息 `metadata` 持久化、`QuestionCard` 子部件复用 | **AC-10** | 规格已建，小验证可与 Change 10 并行 |
| **12** | `m2c-mistakes-and-knowledge-cards` | `mistake-review`、`knowledge-cards`；修改 `local-storage`、`local-backup-restore`、`mastery-topics` | 3a 只读错题回看（`learning_evidence ∩ interactions` + 自测错题）；3b `knowledge_cards`（SQLite v6、8 表备份 + v5 兼容恢复、收藏与搜索、向导作 `text_note`）；系统输入法语音与阶段 4 全链路整合验收 | **AC-11、AC-12** | 规格已建，建议在 Change 10 归档后 apply |

### 依赖与并行关系

```text
M2-B 全部归档 --> 阶段 0: M3 (AC-08 Release 基线) + V0.4 范围决策
                     |
                     +--> Change 10 (m2c-review-reminders) -----------------------+
                     |                                                            |
                     +--> [并行] Change 11 小验证 --> Change 11 (chat-quick-check) +--> Change 12 (mistakes & knowledge-cards, SQLite v6 + 阶段4整合)
```

> 说明：3a 错题回看为纯只读投影，不改 Schema；3b 知识卡涉及 SQLite v6 与备份 7→8 表升级，放在 Change 10（修改 `settings` 提醒配置）之后单独实施，避免与 `settings`/备份变更交叉冲突。

---

## 四、可选提案：移动端 Skill 与 ima 知识库（待评审）

不替换上方已实施的 Change 10–12，也不改变 P0 学习闭环。产品需求与独立验收编号见 [PRD 10：移动端 Skill 管理与 ima 知识库](../docs/prd/10-mobile-skills-and-ima-knowledge.md)，技术设计参见 [移动端 Skill 与 ima 扩展设计 V0.4](../docs/evaluation/mobile-skill-ima-extension-plan-v0.4.md)。

| Change ID | 范围 | Gate |
|---|---|---|
| [m2c-mobile-skill-management](changes/m2c-mobile-skill-management/proposal.md) | 移动端 Skill 导入/管理/作用域/按需加载、LF01、小老师、备份安全 | 自定义教学 Skill 真机闭环 + 原 M2-B 回归 |
| m2c-ima-knowledge-lf01 | 通用 KnowledgeProvider、ima 只读连接/检索/原文/引用、移动兼容 Skill | 真实库真机验证、无独立业务后端、无凭据泄漏 |
| m2c-knowledge-mastery | 路径资料绑定、Outline/Study/Review | 资料证据与学习证据分离，原评分/复习/恢复门禁不退化 |

仅 Skill 管理项已有详细 change；ima 与知识掌握待前一项验收归档后再生成 specs/tasks。不引入市场、脚本执行器、云同步或本地重型 RAG。
