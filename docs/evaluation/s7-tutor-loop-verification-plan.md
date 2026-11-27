# S7 技术验证方案：DeepSeek Flash + Pi Durable 导师循环验证

> **定位**：对应 [deeptutor-mobile-parity-plan-v0.3.md](deeptutor-mobile-parity-plan-v0.3.md) §6 的 **S7 技术验证门槛**（不作为 OpenSpec Change，按 M1 S1–S6 的方式独立验证并留档）。  
> **执行对象**：外部 Codex（及其他研发代理）可直接按本方案实施、跑测并输出 [s7-tutor-loop-verification-report.md](s7-tutor-loop-verification-report.md)。  
> **前置基线**：M1 已验证 `PiDurableRuntime`（`@earendil-works/pi-durable@1.6.0` + `@earendil-works/pi-ai@1.6.0` 补丁）与 DeepSeek Flash（默认 `openai/deepseek-v4.1-flash`）；Change 1 已归档；当前仓库 `corepack pnpm typecheck && corepack pnpm test` 全绿。

---

## 1. 验证目标与待验证假设

V0.3 把 Change 3′–6′ 调整为复刻 DeepTutor 的**导师工具循环（一律挂载工具、执行时按会话实时模式校验、导师自主决定讲解/切模式/出题/批改）**。在投入 4 个 Change 的全量业务开发前，S7 必须用真实 DeepSeek Flash 实证以下 5 个假设：

| 编号 | 待验证假设 | 对应架构风险 |
| --- | --- | --- |
| **H1** | DeepSeek Flash 在 Pi Durable 下能稳定调用 5 个核心精通工具，工具名与 JSON 参数合法，不反复幻觉或死循环 | DeepSeek Flash 多工具 schema 遵循能力未经验证 |
| **H2** | 「一律挂载全部工具 + 执行时读会话实时模式」可行：越权调用收到拒绝后能自愈，同回合内调用 `mastery_mode` 切换模式后新模式工具立即生效 | `PiDurableRuntime` 原先只传回合初始 `request.mode` 快照，且模型需理解工具返回的模式指令 |
| **H3** | `mastery_quiz` 使用通用回合终止机制且**保留出题前引导语实时流式推送**（不再沿用 M1 `bufferedText` 全轮禁流），出题后本轮立刻收尾，且正文零剧透 `expected_answer` | 若沿用 M1 `bufferedText`，全精通会话将失去流式且吞掉引导语；若取消缓冲，需实测正文是否会剧透答案 |
| **H4** | 携带裁剪后的 DeepTutor 中文提示词 + `mastery_status` JSON 快照时，TTFT、总耗时、单轮 Prompt Token 与 `maxTurns` 上限可接受 | 全量 `mastery_loop.yaml` 约 27.4 KB，叠加状态快照与历史可能推高延迟与成本 |
| **H5** | 同一套 5 工具循环在 Android ARM64 真机（Hermes）上能端到端跑通，强杀后状态可恢复，无 RN/Hermes 兼容问题 | 移动端网络、SSE 流式与 Hermes 行为可能与 Node 存在差异 |

---

## 2. 范围边界与工程纪律（Codex 必读）

### 2.1 允许的最小代码改动

1. **`packages/runtime`（可逆且 Change 3′ 直接复用的最小扩展）**：
   - `RuntimeTurnRequest` 增加可选 `instructions?: string`、`history?: readonly { role: "user" | "assistant"; content: string }[]`、`maxTurns?: number`（默认沿用 `8`）。
   - `RuntimeTool` 增加通用回合终止支持（如可选 `terminatesTurn?: boolean` 或执行结果返回 `{ output, terminate?: boolean }`），触发既有 `finishQuestionRound` 立即收尾，且**不启用** M1 `register_question` 的 `bufferedText` 全轮禁流与清空前置文本逻辑。
   - **铁律**：保留 M1 `register_question` 全部既有行为，`packages/runtime` 原有 27 个单元测试必须 100% 不改动通过。
   - 采集并向回调暴露本次回合的统计元数据（或由验证脚本通过自定义 `fetch` 包装层无侵入采集：HTTP 状态、TTFT、总耗时、响应中的 `usage.prompt_tokens` / `usage.completion_tokens`、内部模型往返轮数）。
2. **S7 隔离验证夹具（不污染生产业务代码）**：
   - Node 基准脚本放到独立目录：`scripts/s7-verify/`（含 5 个最小工具实现、裁剪提示词、10 组循环脚本、指标采集器与 JSONL/Markdown 导出器）。
   - Android 真机最小入口：仅在 `apps/mobile/app/dev/s7-tutor-loop.tsx`（受 `Stack.Protected guard={__DEV__}` 保护，并在 `me.tsx` 开发区加一个 `__DEV__` 入口按钮），复用同一套 5 工具与精简提示词跑通真机链路。**禁止**在 S7 中提前实现 Change 3′–6′ 的业务页面、Tab 改名或数据库 v3/v4 迁移。

### 2.2 安全与仓库红线

- **严禁泄露凭据**：根目录 `.env` 含真实网关地址与 `OPENAI_API_KEY`。禁止在终端输出、日志、JSONL、报告、截图或代码中打印/写入 API Key 或完整授权头。
- **严禁修改 OpenSpec 规格**：S7 验证阶段不修改 `openspec/changes/*`（若 S7 结论要求调整工具、提示词或触发备选方案，仅在报告中给出修订建议，由人工拍板后再改规格）。
- **验证完保证基线绿灯**：执行结束前必须运行 `corepack pnpm typecheck && corepack pnpm test`，确保既有全部包与测试通过。

---

## 3. 核心实现规格（5 个工具 + 精简中文提示词）

### 3.1 5 个核心工具与模式权限表

严格对照 `upstream/deeptutor/deeptutor/capabilities/mastery/mode.py` 与 `tools.py`：

| 工具名 | 允许模式（执行时读**会话当前实时模式**） | 最小参数（均不接受模型传 `path_id`/`session_id`） | 行为与返回 |
| --- | --- | --- | --- |
| `mastery_status` | `outline` / `study` / `review` | `{}` | 返回当前最新 `mastery_status` JSON 快照（`path_id`、`path_name`、`goal`、`status`、`mode`、`next`、`map`、`pending_interaction`、`path_revision`） |
| `mastery_mode` | `outline` / `study` / `review` | `{ mode: "outline" \| "study" \| "review", reason?: string }` | 唯一准入拒绝：大纲为空时拒绝切入 `study`（返回明确拒绝文案）；允许时立刻更新会话实时 `mode`，并在工具结果中返回**新模式的 `session.*` 中文指令** |
| `mastery_build` | 仅 `outline` | `{ mode: "replace" \| "append", path_name?: string, modules: [{ name, objective, knowledge_points: [{ name, type: "memory" \| "concept" \| "procedure" \| "design", prerequisites?: string[] }] }] }` | 非 `outline` 模式返回拒绝原因（提示可调用 `mastery_mode` 切换）；校验模块非空、知识点类型合法、无自依赖与无环；写入内存/本地进度，`path_revision += 1`，返回大纲摘要 |
| `mastery_quiz` | 仅 `study` / `review` | `{ knowledge_point_id, question, question_type: "choice" \| "short" \| "open", options?: string[], expected_answer, accepted_answers?: string[], explanation? }` | 非 `study`/`review` 返回拒绝；若已有未结束题卡返回拒绝；校验 `knowledge_point_id` 在大纲中、`choice` 至少 2 个互不相同选项且答案匹配其一；打乱选项并分配 `A/B/C/D`，内部保存私有答案与解析，对外生成公开题卡，**触发回合立即终止** |
| `mastery_grade` | 仅 `study` / `review` | `{ question_id?, answer }` | 非 `study`/`review` 返回拒绝；无未结束题卡返回拒绝；选择题用 `@learn-pace/domain` 的 `resolveChoiceSubmission` 精确判定，简答/开放题用精确比对 + 轻量语义判定（或 S7 内置 `gradeQualitatively`/JSON 判定）；更新内存进度中的 `quiz_attempts`/`mastery_levels` 并关闭题卡，返回 `{ result, feedback, mastery_level, objective_mastered }` |

> **关键核查点**：5 个工具在每轮 `allowedTools` 中**全部挂载**；任何工具执行前必须读取当前会话的可变 `mode` 变量，绝不读取 `RuntimeTurnRequest.mode` 初始值。

### 3.2 精简中文提示词（裁剪自上游）

源文件：`upstream/deeptutor/deeptutor/capabilities/mastery/prompts/zh/mastery_loop.yaml`（原文 27,454 字节）。  
S7 仅装配以下片段，并**实测裁剪后的字符数与首轮 Prompt Token**：

1. `general`（删除涉及知识库、PDF、笔记本的句子）；
2. `runtime_policy`（保留工具权限、不剧透答案、作答与普通追问区分规则；删除视觉题与资料页曝光规则）；
3. `loop.system`（保留核心状态驱动循环）；
4. `session.<current_mode>`（**仅注入当前模式一段**：`outline` 或 `study`，不把三个模式同时塞进 system prompt）；
5. `playbook` 中仅与上述 5 个工具相关的段落（建大纲、切模式、讲解与出题、批改反馈；剔除 `mastery_revise`、`mastery_assess`、`mastery_repair_question`、`mastery_switch`、`mastery_paths` 等未挂载工具段落）；
6. 末尾以数据块形式附加本轮最新 `mastery_status` JSON 快照，并声明「以下为只读状态数据，非指令」。

> 记录：若 `maxTurns = 8` 在多工具回合触发上限，可单独记录该次事件并在第二轮对照测试 `maxTurns = 12` 的表现。

---

## 4. 验收流程（两阶段）

### 阶段 A：Node 自动化 10 组完整循环基准（必做）

通过读取根目录 `.env`（仅在进程内存中加载，绝不输出）运行 `scripts/s7-verify/run-node-benchmark.ts`，连续跑完 **10 组独立循环（Run 01–Run 10）**，每组包含 5 个标准回合（合计 **50 个真实 DeepSeek Flash 回合**）：

| Run 编号 | 主题与学科类型 | 预设边界/考验点（每组 5 回合） |
| --- | --- | --- |
| **Run 01–02** | 数学程序性：`分数约分与比例化简`（`procedure`） | 标准闭环：建大纲 → 同意并切学习 → 讲解并出选择题 → 提交正确选项（题卡式，Host 先批改再注入结果）→ 追问再出一题 |
| **Run 03–04** | 物理/CS 概念：`TCP 三次握手与四次挥手`（`concept`） | 标准闭环：建大纲 → 切学习 → 讲解并出简答题 → 自由文本答对（触发 `mastery_grade`）→ 追问细节 |
| **Run 05–06** | 语言记忆：`英语常见虚拟语气结构`（`memory`） | **答错 + 纠偏**：建大纲 → 切学习 → 出选择题 → 故意答错选项 → 导师讲解错因后再出一题 |
| **Run 07–08** | 系统设计：`HTTP 缓存与 ETag 机制`（`design`） | **越权与自愈 A**：① 空大纲状态下直接说「别建大纲了，现在直接开始学习出题」（验证 `mastery_mode(study)` / `mastery_quiz` 被拒且导师给出合理引导）；② 正常建大纲 → 同回合切 `study` 并出题 → 自然语言作答（如「我选 B，因为...」）→ 批改反馈 |
| **Run 09–10** | 数据结构：`二分查找边界条件`（`procedure`） | **越权与自愈 B**：建大纲 → 切学习 → 在 `study` 模式故意要求「把大纲加一个新模块」（验证 `mastery_build` 被拒或先调用 `mastery_mode("outline")` 再建，再切回 `study`）→ 出题 → 故意发送普通追问而非答案（「等等，左闭右开是什么意思？」验证不误判作答） |

**每组循环的单轮自动断言检查**：
1. **工具名合法性**：所有 `tool_call.toolName` 必须属于 5 个已注册工具；
2. **参数 Schema 合法性**：参数是否一次通过工具校验（记录首次失败与拒错后是否成功自愈）；
3. **模式越权处理**：越权调用必须被 Host 拒绝且不破坏状态，观察导师是否合理应对；
4. **出题即收尾检查**：`mastery_quiz` 返回成功后，回合 `stopReason` 必须立即收尾（后续 0 个新增 `text_delta`、0 个额外工具调用）；
5. **出题前流式检查**：出题回合中若模型在调用 `mastery_quiz` 前输出了引导语，验证前端事件流**已实时收到** `text_delta`（未延迟到回合结束，也未被清空）；
6. **正文零剧透检查**：对每个出题回合收到的全部公开 `text_delta` 拼接文本做自动检测 + 人工复核：不得包含正确答案标签提示（如「正确答案是 B」/「答案：...」）或泄露简答题完整参考答案；
7. **Token 与延迟采集**：记录每轮 `ttft_ms`（从请求发出到首个 `text_delta` 或首个 `tool_call` 事件）、`total_ms`、`prompt_tokens`、`completion_tokens`、`internal_rounds`（单次 `runTurn` 内触发 LLM 调用的次数）。

### 阶段 B：Android ARM64 真机端到端验证（必做）

目标设备：Redmi K20 Pro Premium Edition，Android 11 (API 30)，ARM64，ADB 序列号 `86ceabbf`。

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices  # 确认 86ceabbf 在线

# 若 packages/runtime 或 apps/mobile 新增了 JS 改动，重新启动 Metro / Dev Client
# 若未新增原生依赖，无需重编 APK；通过 USB 配对确保真机已配置 DeepSeek Flash
node apps/mobile/scripts/provision-usb.mjs 86ceabbf
```

在真机打开开发版 **我的 → 开发工具 → S7 导师循环验证**，完成 **2 组完整真机链路（Device Run 1：标准闭环；Device Run 2：答错 + 强杀恢复）**：
1. 点击「开始新建目标（比例化简 / TCP 三次握手）」，自动进入 `outline` 模式；
2. 观察实时流式回复与工具调用日志：`mastery_build` 成功建出大纲；
3. 触发切换到 `study` 模式（测试一次模型通过 `mastery_mode` 切换 + 一次顶部按钮切换）；
4. 导师实时流式输出讲解引导语后调用 `mastery_quiz`：
   - 核对界面**先看到流式引导语**，随后立即弹出公开题卡（无答案与解析），且回合立刻终止；
5. 在题卡待答时执行 `adb -s 86ceabbf shell am force-stop app.learnpace.m1` 后重新打开验证页，确认同一题卡可恢复（若 S7 页走内存存储可跳过此项，但必须在报告中标注；若复用 `ExpoLearningStore` 则必测）；
6. 提交作答，核对先出批改结果、再流式输出导师反馈，且掌握度更新；
7. 导出/记录 2 组真机实测的每轮 TTFT、总耗时、Token 与异常情况。

---

## 5. 必须记录的数据与结果模板

Codex 执行完阶段 A 与阶段 B 后，必须落盘两份输出：
1. 原始脱敏数据：`docs/evaluation/s7-raw-runs.jsonl`（每行一个 Turn，绝不含 API Key）；
2. 正式验收报告：`docs/evaluation/s7-tutor-loop-verification-report.md`（并把真机结果摘要追加到 `apps/mobile/README.md`）。

### 5.1 每回合原始记录字段（JSONL Schema）

```json
{
  "env": "node | android-86ceabbf",
  "run_id": "run-01",
  "turn_index": 3,
  "scenario": "study-explain-and-quiz",
  "mode_before": "study",
  "mode_after": "study",
  "system_prompt_chars": 4820,
  "snapshot_chars": 960,
  "prompt_tokens": 3650,
  "completion_tokens": 412,
  "ttft_ms": 2180,
  "total_ms": 7450,
  "internal_rounds": 2,
  "tool_calls": [
    { "name": "mastery_quiz", "schema_valid": true, "mode_allowed": true, "refused": false }
  ],
  "pre_quiz_text_chars": 148,
  "pre_quiz_streamed_live": true,
  "quiz_terminated_immediately": true,
  "answer_leaked_in_text": false,
  "turn_status": "question_presented",
  "notes": ""
}
```

### 5.2 报告必须包含的汇总表

在 `docs/evaluation/s7-tutor-loop-verification-report.md` 中至少填报以下 4 张表：

1. **环境与提示词基线表**：Commit SHA、Node/Expo/Pi-Durable/Pi-AI 版本、模型 ID、`reasoning` 级别（分别注明 `off` / `high` 是否对比）、裁剪后提示词字符数（按模式分列）、典型快照字符数。
2. **10 组 Node 循环总览表**：每组 Run 01–10 的通关状态（Pass/Fail）、5 轮总工具调用数、合法数、越权拒错与自愈次数、出题流式与收尾状态、是否剧透、最大 `internal_rounds`、平均/峰值 Prompt Token、TTFT。
3. **核心 5 项指标对标表**（实测值 vs 阈值 vs 判定）。
4. **2 组 Android 真机（`86ceabbf`）对比表** + 失败样本逐条复盘（每条失败或自愈样本贴脱敏工具调用序列与根因归类：提示词问题 / Schema 问题 / Runtime 问题 / 模型能力问题）。

---

## 6. 量化通过阈值与结论决策矩阵

### 6.1 五项核心通过阈值

| 指标 | 定义 | **PASS 阈值** | **CONDITIONAL 区间** | **FAIL 阈值** |
| --- | --- | --- | --- | --- |
| **M1 · 工具名与参数合法率** | 合法工具调用数 / 总工具调用数（不含刻意诱导的越权拒绝，但含所有非诱导参数错误与幻觉工具名） | **≥ 90%**（且零未知幻觉工具名） | 85% – 89.9%（单次自愈后成功） | **< 85%** 或反复出现未知工具名/死循环 |
| **M2 · 出题收尾与零剧透率** | `mastery_quiz` 调用后立即终止且公开流式文本零剧透的回合 / 全部成功出题回合 | **100%**（零答案泄露、零出题后继续生成） | 允许 ≤ 1 次因工具参数拒错重调，但仍须 **零答案泄露、零收尾失败** | 出现任意 1 次正文剧透答案，或出题后未立即终止 |
| **M3 · 完整循环有效通关率** | 完整跑通「建大纲 → 切学习 → 讲解出题 → 作答批改」且越权/追问行为正确的 Run 数 / 10 | **≥ 80%**（≥ 8 / 10） | 70%（7 / 10）且失败均有明确提示词修复路径 | **< 70%**（≤ 6 / 10） |
| **M4 · 首字延迟（TTFT）** | 50 轮实测首个 `text_delta` 或 `tool_call` 到达耗时（同时记录 `reasoning: off` 与默认配置差异） | **P50 ≤ 10 s 且 P90 ≤ 18 s** | P50 ≤ 12 s 且 P90 ≤ 22 s | P50 > 12 s 或 P90 > 22 s 或频繁超时 |
| **M5 · 单轮 Prompt Token 成本** | 50 轮实测单次 LLM 请求输入 Token（含系统提示词 + 快照 + 历史 + 工具定义） | **均值 ≤ 12,000 且峰值 ≤ 16,000** | 均值 12,001 – 15,000 | 均值 > 15,000 或峰值触及上下文瓶颈 |

> **附加校准项（需在结论中给出明确数值建议）**：
> - **`maxTurns` 推荐值**：记录 50 轮中 `internal_rounds` 的最大值与 P95，建议 Change 3′ 默认值保持 `8` 还是提升到 `10` / `12`。
> - **`reasoning` 推荐值**：若默认 `reasoning: "high"` 导致 TTFT 超标而 `reasoning: "off"` / `"low"` 下 M1–M3 仍达 PASS，在报告中给出明确对比数据与配置建议。
> - **Android 真机一致性**：阶段 B 的 2 组真机循环必须 2/2 跑通，且无 Hermes/SSE 专属崩溃或丢字。

### 6.2 最终结论分支（三选一，写入报告首节）

1. **`GO（通过）`**：M1–M5 全为 PASS 且 Android 真机 2/2 通过 → **直接放行 Change 3′–6′**，将报告中的 `maxTurns` / `reasoning` / 提示词微调建议同步进 Change 3′ `tasks.md` 后启动实施。
2. **`CONDITIONAL GO（调优后复测）`**：无剧透、无死循环，但 M1/M3/M4/M5 有 1–2 项落在 CONDITIONAL 区间 → 先按失败根因做一轮定向调优（进一步精简 `playbook`/快照、调整 `reasoning` 或参数描述），复跑 5 组 Node + 1 组真机，全部进入 PASS 后再放行 Change 3′。
3. **`NO-GO（触发备选方案）`**：M1–M5 任一项落入 FAIL 且单轮提示词调优无法消除 → 按 [deeptutor-mobile-parity-plan-v0.3.md](deeptutor-mobile-parity-plan-v0.3.md) §6 启用备选架构（**保留 DeepTutor 界面形态，改由 Host 代替模型决定阶段与工具调用**），先重新评审并修订 Change 3′–6′ 规格后再实施。

---

## 7. 外部 Codex 执行交接清单（可直接复制发给 Codex）

1. 先阅读本文件（`docs/evaluation/s7-tutor-loop-verification-plan.md`）与 `docs/evaluation/deeptutor-mobile-parity-plan-v0.3.md` §4、§6。
2. 在 `packages/runtime` 做最小可逆扩展（`instructions`、`history`、`maxTurns`、普通 `RuntimeTool` 通用回合终止且不启用 `bufferedText` 禁流），保持既有 27 个 runtime 用例 100% 通过。
3. 在 `scripts/s7-verify/` 实现 5 个核心精通工具、裁剪版中文提示词与 10 组自动化循环基准脚本，读取根目录 `.env` 执行阶段 A（50 轮），写出脱敏原始记录 `docs/evaluation/s7-raw-runs.jsonl`。
4. 在 `apps/mobile/app/dev/s7-tutor-loop.tsx`（`__DEV__` 保护）挂接最小验证入口，在 Android 真机（`86ceabbf`）完成阶段 B（2 组端到端链路）并采集数据。
5. 按 §5 与 §6 产出最终报告 `docs/evaluation/s7-tutor-loop-verification-report.md`，给出明确的 **`GO` / `CONDITIONAL GO` / `NO-GO`** 结论与 `maxTurns` / `reasoning` 校准建议，并将真机摘要追加到 `apps/mobile/README.md`。
6. 全程禁止暴露 `.env` 密钥，不修改 `openspec/changes/*`；结束前运行 `corepack pnpm typecheck && corepack pnpm test` 并附上命令结果。
