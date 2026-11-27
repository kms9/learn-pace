# Learn Pace · 可行性评估与实施方案（V0.2）

2026-11-24 · 基于 PRD V0.2、原型 V0.2、三个上游固定提交源码核对及团队最新工程决策修订 · 工期为粗估，需评审

上游核对版本：DeepTutor `1284116`、DeepTutor Lite `5082b93`、Cherry Studio Mobile `14a0224`（与 `.gitmodules` 子模块指针一致）。本文未运行任何 App 测试。

## 已确认决策（2026-11-24）

以下 6 项决策已拍板，作为当前阶段（M0–M2）的工程执行基线：

| # | 决策项 | 结论 |
|---|---|---|
| D1 | 开源与 Cherry 复用 | Learn Pace 本身是开源项目，且已与 Cherry Studio App 作者沟通获得明确授权，**可以直接使用和参考 Cherry Studio Mobile 中可用的代码与设计** |
| D2 | Pi 版本策略 | **直接使用 Pi 的最新版本**（当前 npm 最新版为 `1.6.0`，实施时锁定最新稳定版），不局限于上游子模块的旧版本 |
| D3 | 事务控制节奏 | **快速推进期不使用事务控制**；优先跑通 LF01/LF02 主要业务流程，主流程完成后再统一补齐事务、CAS、幂等与故障恢复 |
| D4 | Agent Runtime 选型 | **尽量使用 Pi Durable**（`@earendil-works/pi-durable`），基于 Cherry 的移动端适配方案升级推进 |
| D5 | 首期模型接入范围 | **目前仅确保 DeepSeek Flash 模型接入即可**（按本地 `.env` 的 OpenAI-completions 兼容配置，支持 streaming、tool calling 与 JSON 输出；详见 `.env.example`），首期不保证其他厂商或更多模型的兼容性 |
| D6 | 文档一致性 | 已按当前最新仓库状态与上述决策同步更新各处文档，消除过时描述与重复定义 |
| D7 | P0 产品默认规则（已冻结） | 采用 **4 Tab**（首页/问答/路径/我的）；**P0 不做自报掌握**；**复习失败策略与 DeepTutor `scheduler` 一致**（掌握与保持分开记，失败标保持风险并生成补救任务）；**首期附件仅支持文本与选文** |

## 结论

**项目可行，核心阻断项已解除。** 开源定位与 Cherry 作者明确授权显著降低了移动端 Runtime 适配成本；采取“最新版 Pi Durable + DeepSeek Flash 单模型 + 主流程先行/事务后置”的策略后，可以更快跑通 LF01/LF02 端到端闭环。

| 维度 | 评级 | 依据 |
|---|---|---|
| 产品与业务定义 | 🟢 高 | LF01/LF02 范围收得紧。PRD 已经细到状态机、命令、数据流和 AC-01~08 验收，原型有 41 个状态且资产已全部同步 |
| 学习领域迁移 | 🟢 高 | DeepTutor 的学习域是纯规则代码，核心算法不大（`compute_mastery` 只有 40 行），还带约 1.45 万行测试，可以直接当对照基准 |
| 移动端 Runtime | 🟢/🟡 可控 | 明确采用最新版 Pi Durable，并可直接复用已获授权的 Cherry Studio Mobile RN 适配代码与设计；主要工作量是把 Cherry 基于 `1.5.0` 的补丁（pi-ai 849 行、pi-durable 171 行、metro 32 行）迁移并精简到 Pi 最新版 |
| 数据一致性与恢复 | 🟡 分阶段 | 快速推进期不做事务控制和 CAS，先跑通核心主流程；主流程完成后再补齐原子事务、CAS、幂等与崩溃恢复对账（分层设计保证后补不返工） |
| 许可证与合规 | 🟡 按人群评估 | 项目开源且已获 Cherry 作者明确授权，**代码复用阻断已解除**；仅在未来面向中小学生公开上线前，需单独评估未成年人隐私与生成式 AI 合规门槛 |
| 当前工程基础 | ⚪ 零 | 仓库目前只有文档和原型，尚未建立应用代码骨架 |

## 一、核对上游代码的发现与最新结论

**1. Cherry Studio Mobile 可直接复用与参考（已获作者明确授权）。**
- Cherry Studio Mobile（AGPL-3.0）包含完整的移动端 Pi 适配代码（`src/backend/ai/agent/runtime/pi/`，约 1.06 万行）以及 `patches/` 下的 RN/Hermes 兼容补丁。
- Learn Pace 本身开源，且已与 Cherry Studio App 作者沟通获得明确授权，可直接复用和参考其可用代码、补丁思路与移动端工程设计（Expo/SQLite/事件投影等），不再需要从零重写 RN 适配层。
- 复用时仍应做好清晰的开源归属声明与许可证说明。

**2. 其他依赖的许可证没问题。**

| 项目 | 许可证 | 备注 |
|---|---|---|
| `@earendil-works/pi-durable` / `pi-ai` / `pi-agent-core` | MIT | npm 上当前最新为 `1.6.0`（2026-11-20 发布），我们直接使用最新版本 |
| DeepTutor | Apache-2.0 | 移植时保留 NOTICE，标注修改 |
| DeepTutor Lite | MIT | 参考 Harness / Skills / Tools 装配思路 |
| Cherry Studio Mobile | AGPL-3.0（已获作者明确授权复用） | 复用其 Pi RN 适配与移动端工程设计，保留归属说明 |

**3. Pi 版本升级与补丁迁移。**
- DeepTutor Lite 用的是 `pi-agent-core ^0.83`，Cherry Studio Mobile 固定提交用的是 `pi-durable 1.5.0`，而 npm 当前已发布 `1.6.0`。
- 按决策 D2，我们**直接使用 Pi 最新版本**。因此 Cherry 的适配代码与 `patches/` 不能直接照搬旧版本号，需要在 M1 逐项核对新版 Pi 是否已修复部分 RN/Hermes 问题，迁移并精简必要补丁；DeepTutor Lite 的 Harness 仍只参考装配思路。

**4. Runtime 主选 Pi Durable。**
- 按决策 D4，移动端 Runtime **尽量使用 `@earendil-works/pi-durable`（最新版本）**，充分利用 Cherry 已有适配经验，不再在 M1 并行开发自研轻量 Agent Loop 做双路线选型。
- 架构上仍坚持两项原则：`learn-pace.db` 是学习业务状态的唯一权威记录（题卡落库后本轮即结束，下一轮读业务库），且 `packages/runtime` 保留 `AgentRuntime` 端口抽象，隔离 Pi 升级对业务层的影响。

**5. DeepTutor 的学习域可以只取一部分来移植。**
- `learning/` 加 `capabilities/mastery/` 一共约 2 万行 Python。
- P0 真正要用的核心大约 4~5k 行，包括：
  - 模型与状态：`models`、`mastery`、`policy`
  - 复习调度：`scheduler`（类 FSRS 的稳定度/遗忘率模型）、`review_strategy`
  - 评估：`assessment`、`grading`
  - 交互与大纲：`pending`、`outline_revision`、`objective_relations`、`question_card`、`identity`
- `service.py`（3426 行）和 `storage.py`（2284 行）是绑定服务端的代码，应该按 PRD 的命令契约重写，不要逐行翻译。

**6. 文档不一致已按最新状态清理同步。**
- **PNG 资产状态**：提交 `030a9ff` 已同步全部 65 张原始 PNG（`docs/design/assets.sha256` 共 66 项校验全部通过），已更新根 README、`docs/design/README.md`、`v0.1/README.md`、`v0.2/README.md` 以及 PRD `02` 中 P07 的原型对应（`D08`）。
- **PRD 重复与编号**：已修正 `02` 的重复 `## 3.` 标题、`07` 的倒序编号，并去除 `02`/`07`/`09` 与 `learning-loop-review-v0.2.md` 之间的整段重复复制，每条规则保留唯一权威出处。
- **上游链接对齐**：根 README 中的上游源码链接已统一固定到与 `.gitmodules` 和 PRD 一致的提交 SHA。
- **工程与产品基线对齐**：README、roadmap、PRD `01`/`04`/`06`/`07`/`08`/`09` 已同步 D1–D7 全部决策（含 4 Tab、P0 不做自报掌握、复习失败策略与 DeepTutor 一致、首期附件仅文本与选文）；NFR-09 量化基准将在 M1 真机验证时补齐。

## 二、主要风险与应对

| # | 风险 | 影响 | 应对 |
|---|---|---|---|
| R1 | 最新版 Pi Durable 在 RN/Hermes 上与 Cherry（`1.5.0`）的补丁存在差异，或后续小版本变更带来适配成本 | M1 适配耗时增加 | M1 先在 Android 真机完成最新版 `pi-durable` 补丁迁移与裁剪并锁定版本；`packages/runtime` 保留端口抽象隔离业务层 |
| R2 | 开源协议与上游归属声明不清晰 | 协作或对外发布产生合规争议 | 明确仓库自身开源许可证，规范保留 DeepTutor Apache-2.0 NOTICE 与 Cherry Studio Mobile 作者授权/归属声明 |
| R3 | DeepSeek Flash 对概念、设计类题目的定性评分稳定性不足 | 掌握度失真 | 定性评估只产出带依据的结构化结果，掌握门禁由本地规则决定；保留原文并支持后续复核/作废；针对 DeepSeek Flash 准备评分小样本做回归 |
| R4 | DeepSeek Flash 在工具调用或 JSON 结构化输出时出现格式漂移 | 题卡登记失败 | M1 S2 专项验证 DeepSeek Flash 的工具调用、流式输出与结构化题卡生成，加入严格 schema 校验与失败重试；暂不分散精力兼容其他模型 |
| R5 | 快速推进期暂不做事务控制，后期补齐事务/CAS/幂等时出现耦合返工 | 加固阶段改造成本上升 | 严格保持 `domain`（纯规则）与 `app-host`（命令编排）/ `infra`（存储）分层；主流程期先用顺序落库跑通，加固阶段在 Host/Repository 边界统一包裹事务、CAS 与 `submission_id` 幂等 |
| R6 | 面向未成年人上线 | 公开上线受阻 | P0 先面向自用、成人和自学者；如面向中小学生公开发布，上线前单独做合规评估（监护人同意、数据外发告知、模型服务备案） |
| R7 | Python 和 TS 两边的学习规则行为漂移 | 掌握度与复习调度出错 | 用 DeepTutor 固定提交生成 JSON 对照样本，在 TS 的 CI 里逐条比对 |

## 三、实施方案

### 3.1 技术架构

```text
learn-pace/
├─ apps/mobile/            Expo（Dev Client）+ RN，只放 UI 和投影订阅
├─ packages/domain/        纯 TS：Path/Objective、Mastery、Policy、Scheduler、Assessment（不依赖 RN 或 Pi）
├─ packages/app-host/      Commands、Turn Coordinator；主流程期顺序落库，加固期补齐事务/CAS、幂等、恢复对账
├─ packages/runtime/       AgentRuntime 端口 + 最新版 pi-durable 适配器（复用 Cherry Studio Mobile 适配方案）
├─ packages/infra/         SQLite（expo-sqlite，开 WAL）、迁移、SecureStore、FileSystem
└─ tools/parity/           从 DeepTutor 固定提交导出对照样本的脚本
```

几条硬约束：
- `domain` 和 `app-host` 必须能直接在 Node/vitest 里跑。
- Runtime 只能通过 Host 提供的工具去写业务数据，不能直接改掌握度。
- `learn-pace.db` 是唯一的业务数据来源。

### 3.2 分阶段计划

工期按 2 名 TS/RN 全栈加 0.5 名产品/设计粗估，**仅作参考，需要评审后再定**。得益于可直接复用 Cherry 适配、主选单一 Runtime、首期聚焦 DeepSeek Flash 以及主流程先行策略，前期验证与主流程跑通周期较原方案明显缩短。

**M0 · 基线冻结（已完成规则收口，进入骨架落地）**
- 工程与产品基线已拍板冻结（见文首“已确认决策 D1–D7”，文档不一致已完成同步）：
  - 4 Tab（首页 / 问答 / 路径 / 我的）
  - 自报掌握：P0 不做
  - 复习失败策略：掌握与保持分开记，失败标“保持风险”并生成补救任务，以 DeepTutor `scheduler` 及其测试为基准
  - 首期附件：仅支持文本与选文
  - 首期模型：DeepSeek Flash（OpenAI-completions 兼容，支持 streaming / tool calling / JSON，本地配置见 `.env.example`）
- 剩余轻量事项：补充仓库开源 `LICENSE` 文件；公开发布前如面向未成年人再单做合规评估（当前研发/自用不阻塞）。
- 把 PRD 的状态枚举和命令表落成 `packages/domain` 的类型定义和接口签名。
- **过关条件**：`packages/domain` 类型契约可编译通过，准备切入 M1 验证。

**M1 · 技术验证（约 2~3 周）**：6 个验证项，聚焦最新版 Pi Durable + DeepSeek Flash 真机跑通

| 验证项 | 内容 | 通过标准 |
|---|---|---|
| S1 | 在 Android ARM64 上跑通 Expo Dev Build，接入 `expo-sqlite`（WAL）和 `SecureStore` | 真机安装后能正常读写，重启应用后数据还在 |
| S2 | 对接 **DeepSeek Flash** 模型，验证流式输出、工具调用、结构化 JSON 输出与取消 | 停止后状态准确不误报成功；能稳定返回结构化题卡所需字段 |
| S3 | 复用 Cherry Studio Mobile 的 Pi 适配方案，升级并跑通最新版 `@earendil-works/pi-durable`（含精简后的 RN/Hermes 补丁） | 真机完成"流式输出 → 工具调用 → `RegisterQuestion` → 本轮结束"；输出所需补丁清单与版本锁定 |
| S4 | 移植领域核心：`compute_mastery`、`scheduler`、`policy` 子集 | 和 DeepTutor 对照样本 100% 一致 |
| S5 | 主流程端到端真机闭环（无事务控制版）：出题 → 落库 → 重启读取原题 → 作答 → 评分 → UI 同步 | 完整主流程可在真机跑通且重启后能恢复题目与进度 |
| S6 | 开源归属检查、包体积、冷启动时间实测 | 归属与许可证清单明确；给出 NFR-09 的基准数字 |

**M2 · 双流程实现与加固（分两阶段，约 8~11 周）**

**M2-A · 主流程快速推进（不使用事务控制，约 5~7 周）**
1. **基础设施**：基础表结构与迁移、Repository（直接顺序读写，不加复杂事务/CAS 锁）、DeepSeek Flash 模型配置与连通性测试（P07）
2. **LF01 主流程**：会话创建/恢复、Turn Coordinator、流式输出与停止、Little Tutor 子会话、工具白名单（AC-01、AC-02）
3. **LF02 Outline**：路径与知识点依赖图校验、大纲确认、LF01 转目标（AC-03）
4. **LF02 Study**：Interaction 与题卡生成、作答落库、规则评分与 DeepSeek Flash 定性评分、证据记录、掌握门禁（AC-04）
5. **LF02 Review**：到期队列、独立检索、提示曝光记录、复习结算、下次复习日期（AC-06）
6. **投影与 UI**：HomeSnapshot、PathSummary 等查询投影；P00~P07 核心交互与基础空态/加载态/错误态

**M2-B · 一致性与恢复加固（主流程完成后，约 3~4 周）**
7. **事务控制与幂等**：补齐 `CommitAssessment` 等关键路径的 SQLite 原子短事务、Revision CAS 乐观锁、`submission_id` 幂等去重、题目异议与作废重算（NFR-02、NFR-03、AC-05）
8. **恢复对账与健壮性**：启动时异常状态对账、故障注入测试套件、可控时钟复习回归（NFR-04）
9. **备份与恢复**：数据库快照加 manifest 校验，恢复失败时保留原数据（AC-07）

**M3 · MVP 交付（约 3~4 周）**
- 在 Android 真机上把 AC-01~08 全部跑一遍（含加固后的崩溃恢复与幂等验收），可用 Maestro 做端到端自动化。
- 安全审查：密钥安全存储、数据外发告知、工具权限。
- 性能和兼容性测试，发布构建（EAS）。
- 更多模型接入扩展与 iOS 适配按后续阶段排期。

**合计约 3.5~5 个月（其中约 2 个月左右可交付完整可体验的 LF01/LF02 主流程，后续阶段完成事务/恢复加固与发布验收）。**

### 3.3 测试策略

- **领域层**：vitest 单元测试，加上和 DeepTutor 的对照样本比对；状态转移和规则边界用性质测试。
- **LLM 相关（DeepSeek Flash）**：开发阶段使用录制回放样本，不强依赖实时网络；另备一套定性评分小样本，针对 DeepSeek Flash 做稳定性回归。
- **Host 与加固层（M2-B）**：主流程稳定后再补齐故障注入点（提交前、评分前后、刷新前）与可控时钟测试，验证事务原子性、CAS、幂等与复习到期。
- **端到端**：Maestro 在 Android 真机上跑 AC 用例。

## 四、建议的下一步

1. **初始化上游子模块并搭建 monorepo 骨架**（`apps/mobile`、`packages/domain`、`packages/app-host`、`packages/runtime`、`packages/infra`、`tools/parity`）。
2. **优先完成 S4**（`packages/domain` 类型契约 + DeepTutor 核心规则移植 + 对照样本回归测试），不依赖 RN，最快产出可验证代码。
3. **并行推进 S1 / S2 / S3 真机验证**：基于 Cherry Studio Mobile 的 RN 适配升级最新版 Pi Durable，按 `.env` 接入 DeepSeek Flash 跑通流式输出、取消与结构化题卡工具调用。

[PRD](../prd/README.md) · [实施路线](../roadmap.md) · [闭环复评](learning-loop-review-v0.2.md)
