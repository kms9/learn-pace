# S7 · DeepSeek Flash 与 Pi Durable 导师循环技术验证

## 结论

**GO**。M1–M5 均达到 PASS，Android ARM64 两组通过，可以进入 Change 3′–6′ 实施。

建议默认 **`maxTurns: 8`**。50 轮模型往返 P95 为 3，最大 4，给同轮切换、追加、再次切换等路径保留余量。

建议默认 **`reasoning: "high"`**。正式基准 P50 / P90 首事件均有余量。关闭推理的同场景样本首事件更快，仍出现 1 轮失败，详见对照表和样本复盘。

## 环境与提示词

| 项目 | 实测基线 |
| --- | --- |
| 代码基线 | 2026-11-25 · c26ef577631f1ee6bf016bebefd0a33cdbdc120b + 本次工作区 S7 扩展 |
| Node 与 Android | Node v24.21.0 · Darwin arm64 · pnpm 10.34.9 · Pi Durable / Pi AI 1.6.0。设备为 Redmi K20 Pro Premium Edition · Android 11 / API 30 · ARM64 · ADB `86ceabbf` · Expo 58.0.22 · React Native 0.88.1 / Hermes |
| 模型 | openai/deepseek-v4.1-flash · openai-completions |
| 默认配置 | high 50 轮，off 20 轮（Run 01–02、07–08），maxTurns 8 |
| 裁剪中文提示词 | outline 523 字符，study 530 字符，review 501 字符 |
| 状态快照 | P50 783 字符，范围 161–1509 |
| 正式基准首个请求 | 1456 输入 Token，含提示词、状态与工具定义 |

## 阶段 A · Node 正式基准

| Run | 结果 | 工具总数 / 合法 | 诱导拒绝 / 同轮自愈 | 有引导语流式 / 即停且无剧透 | 剧透 | 最大往返 | 平均 / 峰值输入 Token | TTFT P50 / P90 (s) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| run-01 | PASS | 4 / 4 | 0 / 0 | 2/2 · 2/2 | 无 | 2 | 2010 / 2330 | 1.851 / 3.846 |
| run-02 | PASS | 5 / 5 | 0 / 0 | 2/2 · 2/2 | 无 | 2 | 2117 / 2523 | 1.798 / 3.609 |
| run-03 | PASS | 5 / 5 | 0 / 0 | 1/1 · 1/1 | 无 | 2 | 2168 / 2940 | 3.166 / 5.806 |
| run-04 | PASS | 4 / 4 | 0 / 0 | 1/1 · 1/1 | 无 | 2 | 2051 / 2409 | 2.314 / 3.205 |
| run-05 | PASS | 4 / 4 | 0 / 0 | 1/2 · 2/2 | 无 | 2 | 2135 / 2545 | 3.977 / 5.100 |
| run-06 | PASS | 5 / 5 | 0 / 0 | 2/2 · 2/2 | 无 | 2 | 2190 / 2877 | 2.418 / 4.912 |
| run-07 | PASS | 7 / 6 | 1 / 1 | 1/1 · 1/1 | 无 | 3 | 2255 / 2955 | 2.315 / 5.921 |
| run-08 | PASS | 6 / 6 | 1 / 0 | 1/1 · 1/1 | 无 | 2 | 2160 / 2942 | 1.569 / 2.365 |
| run-09 | PASS | 8 / 8 | 0 / 0 | 2/2 · 2/2 | 无 | 4 | 2395 / 3213 | 3.756 / 6.175 |
| run-10 | PASS | 8 / 8 | 0 / 0 | 2/2 · 2/2 | 无 | 4 | 2341 / 3135 | 2.054 / 5.502 |

五个工具调用次数为 `mastery_build` 12、`mastery_mode` 16、`mastery_quiz` 16、`mastery_status` 7、`mastery_grade` 5。有引导语的 15 轮均在出题完成前收到流式增量。1 轮没有引导语，仍成功出题并结束。全部 16 张题卡经过公开正文与私有参考答案比对。

| 指标 | 实测 | PASS 阈值 | 判定 |
| --- | --- | --- | --- |
| M1 · 工具名与参数合法率 | 53/54（98.1%），未知工具 0 | ≥ 90%，零未知工具 | PASS |
| M2 · 出题收尾与零剧透 | 16/16（100.0%），出题重调 0 | 100%，零剧透、零续写 | PASS |
| M3 · 完整循环通关率 | 10/10（100.0%） | ≥ 8/10 | PASS |
| M4 · TTFT | P50 2.251 s，P90 5.100 s | P50 ≤ 10 s，P90 ≤ 18 s | PASS |
| M5 · 单次 LLM 输入 Token | 90 次请求，均值 2199，峰值 3213 | 均值 ≤ 12,000，峰值 ≤ 16,000 | PASS |

TTFT 从 Runtime 回合发起计到首个公开 `text_delta` 或 `tool_call`，百分位取最近秩。Raw 中单个 Turn 的 Token 是该 Turn 内各模型请求用量之和。M5 取每次模型请求的输入用量。

正式基准收到 HTTP 200 的模型请求为 90/90。

### Reasoning 对照

同主题、同脚本对照 Run 01–02、07–08。每组独立生成大纲和题卡。

| 配置 | 回合通过 | 完整循环 | 即停且无剧透 | TTFT P50 / P90 (s) | 总耗时 P50 / P90 (s) | 最长 (s) |
| --- | --- | --- | --- | --- | --- | --- |
| high（50 轮正式） | 50/50 | 10/10 | 16/16 | 2.251 / 5.100 | 4.744 / 7.689 | 13.560 |
| high（配对 20 轮） | 20/20 | 4/4 | 6/6 | 1.823 / 3.831 | 4.144 / 7.395 | 13.560 |
| off（配对 20 轮） | 19/20 | 3/4 | 6/6 | 1.019 / 1.934 | 2.952 / 7.732 | 75.013 |

## 阶段 B · Android 真机

| 运行 | 主题 | 切学习方式 | 前置流式 / 即停且无剧透 | 强杀恢复 | 批改与掌握度 | Reasoning | 结果 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Device 1 | 比例化简 · 选择题 | 模型调用 mastery_mode | 1/1 · 1/1 | 强杀验证见 Device 2 | 答对 · 50% · 先保存批改 | high | PASS |
| Device 2 | TCP 三次握手 · 简答题 | 顶部按钮 | 1/1 · 1/1 | device-2-1795600404577-q1，PID 13691 → 14947，模型回合数不变 | 答错 · 0% · 先保存批改 | high | PASS |

| 运行 / 轮 | 场景 | TTFT (s) | 总耗时 (s) | 合计输入 Token | 合计输出 Token | 往返 | 结束状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Device 1 / 1 | build-outline | 3.351 | 5.611 | 3592 | 715 | 2 | end_turn |
| Device 1 / 2 | switch-study | 5.044 | 7.415 | 3918 | 247 | 2 | end_turn |
| Device 1 / 3 | study-explain-and-quiz | 2.098 | 3.028 | 2000 | 452 | 1 | question_presented |
| Device 1 / 4 | device-host-grade-feedback | 1.772 | 2.460 | 2128 | 287 | 1 | end_turn |
| Device 2 / 1 | build-outline | 3.144 | 4.492 | 3581 | 667 | 2 | end_turn |
| Device 2 / 2 | study-explain-and-quiz | 3.960 | 7.232 | 4447 | 916 | 2 | question_presented |
| Device 2 / 3 | device-host-grade-feedback | 4.275 | 6.936 | 4765 | 677 | 2 | end_turn |

真机用 Dev Client 的 S7 路由、Hermes、USB Metro 和独立的 S7 SQLite。公开题卡与流式引导同时做了自动检查和人工复核。诊断试跑以 `device_rehearsal` 单列，不计入两组正式运行。

## 拒绝、失败与边界样本

- 正式 Run 07/1、08/1 与 off 对照同编号第一轮均为 `mastery_mode(outline_required)`，空大纲仍保持 outline。准入按设计拒绝了诱导请求，第 2 轮重建大纲，第 3 轮同轮切换和出题成功。
- 正式 Run 07/4 为 `mastery_grade(invalid_argument) → mastery_grade(ok)`。Schema 与提示词边界是要求原样传自然语言作答，模型第一次未完整照录，同轮重试通过并关闭题卡。
- 正式 Run 09/3、10/3 均为 `mastery_mode(ok) → mastery_build(ok) → mastery_mode(ok)`。模型先转到 outline 追加，再回到 study。两组第 5 轮均只调用 `mastery_status`，原待答题保持打开。
- 正式 Run 05/5 与 off Run 01/3、08/3 均直接调用 `mastery_quiz(ok)`，公开正文 0 字符。阶段 A 按计划只对实际输出的引导语检验流式送达。
- off Run 02/2 为 `mastery_mode(ok) → 第二次模型请求超时`。首个工具事件 1.029 s，75.013 s 后回报 cancelled。第二次请求未收到 HTTP 响应或 Token 用量，无法从该样本区分网关与链路原因。后续回合从已保存的 study 模式继续。
- 真机比例化简诊断试跑第 3 轮为 `mastery_quiz(ok)`，省略引导语，原因归类为提示词遵循。保留原始样本，将真机指令明确为先写可见正文再调用工具，两组正式样本均要求观测到引导语。
- 真机复测期间 USB 曾重新枚举。ADB 恢复在线后重建 Metro 反向端口，继续使用原待答题完成作答，记录中的题卡 ID 与重启前一致。两组正式回合均有完整模型用量。
- 五工具的短答评分采用参考答案或可接受答案的归一化匹配及短语包含规则。Node 的正确答样本由固定脚本从题卡选择，作为工具循环证据，开放式语义评分能力待业务阶段验证。

## 复跑

从仓库根执行 Node 基准。脚本读取根目录 `.env`，运行指标和人工复核材料写入被 Git 忽略的 `tmp/s7-verify/`。重跑前先移开同名样本，保留既有记录。

```sh
corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts
LEARN_PACE_S7_LAST_RUN=2 corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts --calibration --off
LEARN_PACE_S7_FIRST_RUN=7 LEARN_PACE_S7_LAST_RUN=8 corepack pnpm --filter @learn-pace/runtime exec node --import tsx ../../scripts/s7-verify/run-node-benchmark.ts --calibration --off
```

[逐轮脱敏原始记录](s7-raw-runs.jsonl) · [验收计划](s7-tutor-loop-verification-plan.md)
