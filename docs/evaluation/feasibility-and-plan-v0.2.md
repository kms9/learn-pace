# Learn Pace · 可行性评估与实施方案（V0.2）

2026-11-24 · 基于 PRD V0.2、原型 V0.2 与三个上游固定提交的源码核对 · 工期为粗估，需评审

上游核对版本：DeepTutor `1284116`、DeepTutor Lite `5082b93`、Cherry Studio Mobile `14a0224`（与 `.gitmodules` 子模块指针一致）。本文未运行任何 App 测试。

## 结论

**项目可行，但有前提。** 学习业务这部分把握很大，主要风险在移动端 Agent Runtime 和许可证、合规两件事上。

| 维度 | 评级 | 依据 |
|---|---|---|
| 产品与业务定义 | 🟢 高 | LF01/LF02 范围收得紧。PRD 已经细到状态机、命令、事务时序和 AC-01~08 验收，原型有 41 个状态 |
| 学习领域迁移 | 🟢 高 | DeepTutor 的学习域是纯规则代码，核心算法不大（`compute_mastery` 只有 40 行），还带约 1.45 万行测试，可以直接当对照基准 |
| 移动端 Runtime | 🟡 中 | Pi Durable 是 MIT 许可，但要在 RN 里跑起来得打补丁。Cherry 带了 pi-ai 849 行、pi-durable 171 行、metro 32 行的补丁，而且 Pi 版本更新很快 |
| 数据一致性与恢复 | 🟡 中 | 设计是对的（答案先落库、CAS 短事务、幂等），但做起来和测起来都费工夫，是 M2 的主要工作量 |
| 许可证与合规 | 🔴 需先决策 | **Cherry Studio App 是 AGPL-3.0**；面向中小学生要过未成年人隐私和生成式 AI 的监管门槛 |
| 当前工程基础 | ⚪ 零 | 仓库里只有文档和原型，没有任何代码 |

## 一、核对上游代码的发现

**1. Cherry Studio Mobile 是 AGPL-3.0。**
- 它的 Pi 适配代码（`src/backend/ai/agent/runtime/pi/`，约 1.06 万行）和 `patches/` 下的补丁都受 AGPL 约束。
- 如果 Learn Pace 不打算用 AGPL 开源，Cherry 就只能读、不能抄，Pi 的 RN 适配要自己写。
- PRD 只写了"验证许可证"，这一条应该升级成 M0 的阻断项。

**2. 其他依赖的许可证没问题。**

| 项目 | 许可证 | 备注 |
|---|---|---|
| `@earendil-works/pi-durable` / `pi-ai` / `pi-agent-core` | MIT | npm 上当前是 1.6.0，2026-11-20 发布 |
| DeepTutor | Apache-2.0 | 移植时保留 NOTICE，标注修改 |
| DeepTutor Lite | MIT | |

**3. Pi 的版本差距大。**
- DeepTutor Lite 用的是 `pi-agent-core ^0.83`，Cherry 用的是 `pi-durable 1.5.0`，中间跨了大版本。
- 所以 Lite 的 Harness 写法只能参考思路，API 不能直接照搬。

**4. Runtime 不一定非要"Durable"。**
- PRD 的设计是题卡落库后本轮就结束，下一轮先读业务库，学习状态的权威记录在 `learn-pace.db`。
- 这样 Runtime 只需要管流式输出、工具调用和取消，不需要靠 checkpoint 恢复业务。
- 这让"自己写一个轻量 Agent Loop"成了现实可行的备选，能明显降低风险。

**5. DeepTutor 的学习域可以只取一部分来移植。**
- `learning/` 加 `capabilities/mastery/` 一共约 2 万行 Python。
- P0 真正要用的核心大约 4~5k 行，包括：
  - 模型与状态：`models`、`mastery`、`policy`
  - 复习调度：`scheduler`（类 FSRS 的稳定度/遗忘率模型）、`review_strategy`
  - 评估：`assessment`、`grading`
  - 交互与大纲：`pending`、`outline_revision`、`objective_relations`、`question_card`、`identity`
- `service.py`（3426 行）和 `storage.py`（2284 行）是绑定服务端的代码，应该按 PRD 的命令契约重写，不要逐行翻译。

**6. 文档有几处不一致，建议在 M0 一起修掉。**
- 几份 README 都写着"原始 PNG 待补传"，包括根 README、`docs/design/README.md` 和 v0.1、v0.2 的 README。但提交 `030a9ff` 已经加上了这些图，`assets.sha256` 里 66 项校验全部通过。
- PRD 分拆的时候有重复和编号错乱：`02` 里出现两个"## 3."，`07` 和 `09` 原样复制了复评的 §2、§4、§5。将来规则一改，几处很容易不同步。
- 根 README 的上游链接指向 `main` 分支，而 PRD 固定在某个提交上，两边的依据不一样。
- 待冻结项没有负责人，也没有决策记录。NFR-09 性能要求没有量化数字。

## 二、主要风险与应对

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | Pi Durable 在 RN/Hermes 上兼容性差，或者大版本变化导致适配代码要重写 | M1 失败或后期返工 | Runtime 适配层做成可替换的端口；M1 同时验证两条路（见 S3）；版本精确锁定 |
| R2 | AGPL 被误引入 | 发布受阻 | M0 定下项目许可证；把 Cherry 列为"只读参考"；CI 里加许可证扫描 |
| R3 | LLM 对概念、设计类题目的定性评分不稳定 | 掌握度失真 | 定性评估只产出带依据的结构化结果，规则由本地门禁决定；保留原文，允许复核和作废；准备一套评分小样本，按模型分别回归 |
| R4 | 各家模型对工具调用、结构化输出的支持差别大 | 题卡出不来 | P0 只支持能探测到工具调用和 JSON 结构化输出的模型，在 P07 里做能力探测 |
| R5 | 事务、幂等、恢复的边界状态很多 | M2 拖期 | 领域层用纯 TS 写，可以在 Node 里测；配上故障注入点和可控时钟，崩溃场景全部自动化 |
| R6 | 面向未成年人 | 公开上线受阻 | P0 先面向成人和自学者，或只供个人使用；面向中小学生要单独做合规评估（监护人同意、数据外发告知、模型服务备案） |
| R7 | Python 和 TS 两边的行为漂移 | 学习规则出错 | 用 DeepTutor 固定提交生成 JSON 对照样本，在 TS 的 CI 里逐条比对 |

## 三、实施方案

### 3.1 技术架构

```text
learn-pace/
├─ apps/mobile/            Expo（Dev Client）+ RN，只放 UI 和投影订阅
├─ packages/domain/        纯 TS：Path/Objective、Mastery、Policy、Scheduler、Assessment（不依赖 RN 或 Pi）
├─ packages/app-host/      Commands、Turn Coordinator、事务/CAS、幂等、恢复对账
├─ packages/runtime/       AgentRuntime 端口 + 适配器（pi-durable 或自研轻量 loop）
├─ packages/infra/         SQLite（expo-sqlite，开 WAL）、迁移、SecureStore、FileSystem
└─ tools/parity/           从 DeepTutor 固定提交导出对照样本的脚本
```

几条硬约束：
- `domain` 和 `app-host` 必须能直接在 Node/vitest 里跑。
- Runtime 只能通过 Host 提供的工具去写业务数据，不能直接改掌握度。
- `learn-pace.db` 是唯一的业务数据来源。

### 3.2 分阶段计划

工期按 2 名 TS/RN 全栈加 0.5 名产品/设计粗估，**仅作参考，需要评审后再定**。

**M0 · 基线冻结（1~2 周）**
- 写成决策记录（ADR）：
  - 项目许可证，以及 Cherry 只读不抄
  - 4 Tab
  - 自报掌握：建议 P0 不做
  - 复习失败策略：建议掌握和保持分开记，失败只标"保持风险"并生成补救任务，具体以 DeepTutor scheduler 的测试为准
  - 首期附件：建议只支持文本和选文
  - P0 的目标人群
- 修掉第一节第 6 条列的文档问题，每条规则只保留一个出处。
- 把 PRD 的状态枚举和命令表落成 `packages/domain` 的类型定义和接口签名（先不写实现）。
- **过关条件**：从需求到页面、命令、状态、验收用例，每条都能对上；待决项清零。

**M1 · 技术验证（3~4 周）**：6 个验证项，每项给出明确的通过或不通过

| 验证项 | 内容 | 通过标准 |
|---|---|---|
| S1 | 在 Android ARM64 上跑通 Expo Dev Build，接入 expo-sqlite（WAL）和 SecureStore | 真机安装后能读写，杀进程后数据还在 |
| S2 | 用 `expo/fetch` 做流式输出，对接 OpenAI 兼容接口和 Anthropic 两家；支持取消 | 停止后状态准确，不会显示成成功 |
| S3 | Runtime 两条路对比：A 用 pi-durable 加自研补丁，B 用 pi-ai 或 AI SDK 的轻量 loop | 都能完成"工具调用 → RegisterQuestion → 本轮结束"；比较补丁量、包体积和稳定性，写成 ADR |
| S4 | 移植领域核心：`compute_mastery`、scheduler、policy 的子集 | 和 DeepTutor 对照样本 100% 一致 |
| S5 | 端到端杀进程测试：出题 → 落库 → kill → 恢复原题 → 作答 → 评分事务 → UI 同步 | 不重复计分，不丢答案 |
| S6 | 依赖许可证扫描、包体积、冷启动时间 | 没有 AGPL 依赖；给出 NFR-09 的基准数字 |

**M2 · 双流程实现（10~14 周）**，按以下 Epic 推进：
1. **基础设施**：表结构和迁移、Repository、模型配置和能力探测（P07）
2. **LF01**：会话、Turn Coordinator、流式输出与中断恢复、Little Tutor 子会话、工具白名单（AC-01、AC-02）
3. **LF02 Outline**：路径和知识点依赖图校验、Revision 与 CAS、LF01 转目标（AC-03）
4. **LF02 Study**：Interaction 和题卡、按 submission_id 幂等、规则评分和 LLM 定性评分、证据、掌握门禁、异议与作废重算（AC-04、AC-05）
5. **LF02 Review**：到期队列、独立检索、提示曝光记录、复习结算、下次复习日期（AC-06）
6. **投影与 UI**：HomeSnapshot、PathSummary 等；P00~P07 的空态、加载态、错误态（AC-07）
7. **恢复**：启动时对账、故障注入测试套件、可控时钟
8. **备份恢复**：数据库快照加 manifest 校验，恢复失败时保留原数据

**M3 · MVP 交付（4~6 周）**
- 在 Android 真机上把 AC-01~08 全部跑一遍，可以用 Maestro 做端到端自动化。
- 安全审查：密钥、数据外发告知、工具权限。
- 性能和兼容性测试，发布构建（EAS）。
- iOS 视情况评估。

**合计约 4.5~6.5 个月。**

### 3.3 测试策略

- **领域层**：vitest 单元测试，加上和 DeepTutor 的对照样本比对；状态转移和幂等用性质测试。
- **Host 层**：在提交前后、评分前后、刷新前等位置设置故障注入点，再用可控时钟驱动复习到期。
- **LLM 相关**：开发阶段用录制的回放样本，不依赖网络；另外准备一套评分质量小样本，按模型分别回归。
- **端到端**：Maestro 在真机上跑 AC 用例。

## 四、建议的下一步

1. **先拍板两件事**：项目用什么许可证；P0 是否面向未成年人。这两项决定能不能复用代码，也决定上线门槛。
2. 清理文档里的不一致（工作量约半天）。
3. 搭好 monorepo 骨架，先做 S4（领域移植加对照测试），因为它不依赖 RN，最快能见到结果。
4. 并行做 S1、S2、S3 的真机验证。

[PRD](../prd/README.md) · [实施路线](../roadmap.md) · [闭环复评](learning-loop-review-v0.2.md)
