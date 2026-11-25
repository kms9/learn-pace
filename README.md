# Learn Pace

> 本地优先的个性化学习 Agent 项目。以 [DeepTutor](https://github.com/HKUDS/DeepTutor) 的学习业务为参考，借鉴 [DeepTutor Lite](https://github.com/leonyvon/deeptutor-lite) 的轻量化 Agent 实现与 [Cherry Studio Mobile](https://github.com/CherryHQ/cherry-studio-app) 的移动端本地 Agent 架构。

## 项目定位

Learn Pace 的目标是在移动设备上独立运行 **Agent 调度与学习业务逻辑**，不要求用户额外在服务器、NAS、电脑或局域网内安装和维护 DeepTutor 的 Python/FastAPI 业务后端。

- **本地执行**：学习流程、教学状态、会话及学习记录、工具编排与必要的数据持久化由客户端负责。
- **外部模型**：允许直接调用云端或局域网中的大语言模型 API；「独立客户端」不等于「模型离线推理」。
- **可选增强**：素材解析、RAG、网络检索等后续通过可替换的外部服务接口接入，不作为首期学习业务闭环的强制部署前提。
- **先梳理再迁移**：以 DeepTutor 当前业务语义为依据，先界定流程、状态、事件、数据与依赖，再决定具体移动端实现。

## P0：已确认的两条学习流程

当前范围 **仅包含 LF01 和 LF02**，其余学习流程与增强能力暂不纳入本阶段承诺。

| ID | 学习流程 | DeepTutor 当前的具体流程 | 优先级 |
| --- | --- | --- | --- |
| **LF01** | **自由问答与概念辅导** | 提问 → Agent 探索/工具 → 解释或追问 → 保存会话；包含选中文本后发起的 Little Tutor 上下文辅导 | **P0** |
| **LF02** | **Mastery Path 掌握学习** | 学习目标 → 知识点路径 → 诊断 → 讲解 → 费曼检查 → 练习 → 错因诊断 → 复习与进阶 | **P0** |

### LF01 · 自由问答与概念辅导

**用户场景**：学习者自由提问、讨论概念或追问已有解释；必要时 Agent 使用已授权工具、资料或上下文辅助回答。

**业务边界**：
1. 建立或继续一个学习会话，保留消息、选定的模型与上下文。
2. Agent 在允许的能力范围内完成探索、工具调用、解释或交互追问。
3. 支持从已有内容发起上下文关联的细化辅导（Little Tutor 行为作为参考）。
4. 保存会话与学习产出，保证重新打开后可继续学习。

**验收方向**：无需独立业务服务器，客户端可直接使用外部模型 API 完成连续多轮会话、授权工具调用、保存与恢复；工具失败或取消时保留准确的会话状态。

**上游入口**：[Chat capability](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/agents/chat/capability.py) · [Agentic chat pipeline](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/agents/chat/agentic_pipeline.py) · [核心模块声明](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/modules/manifests/core.json)。

### LF02 · Mastery Path 掌握学习

**用户场景**：学习者设定主题/目标，获得知识点学习路径，通过测评、教学、练习与复习逐步掌握知识。

**业务边界**：
1. 创建学习目标与知识点路径，记录知识点、依赖及学习进度。
2. 执行诊断、讲解、费曼式理解检查、练习和错因诊断等教学活动。
3. 记录作答、提示、错误及评价等**学习证据**，由明确的掌握策略确定是否达标。
4. 根据掌握结果决定下一知识点、补救学习或间隔复习；持久化学习状态。

> **实现注意**：上述箭头表达产品学习历程，不代表每个知识点都按固定线性顺序走完全部阶段。DeepTutor 的阶段枚举与知识点推进规则是两层不同机制；是否进阶由学习证据和掌握门槛决定，不能仅依赖 Agent 宣称「学会了」。

**验收方向**：客户端能够独立保存并恢复学习路径、学习证据与复习任务；使用外部模型提供讲解与定性判断，但掌握度更新、进阶决策和数据一致性仍由本地学习业务规则管理。

**上游入口**：[Mastery Path capability](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/capabilities/mastery/capability.py) · [学习模型与阶段](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/learning/models.py) · [路径/掌握决策](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/learning/policy.py) · [掌握度计算](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/learning/mastery.py) · [复习调度](https://github.com/HKUDS/DeepTutor/blob/main/deeptutor/learning/scheduler.py)。

## 架构方向（待技术验证）

```text
Mobile UI
   │
   └── Local Application / Agent Host
         ├── LF01 Chat / Concept Tutoring
         ├── LF02 Mastery Path / Learning Domain
         ├── Agent Runtime + Authorized Tools
         ├── Local SQLite / Files
         └── Model Provider Adapter ───► 外部模型 API（云端或局域网）
```

候选技术：**React Native / Expo + TypeScript + SQLite**；Agent Runtime 对比 **Pi Durable** 与 DeepTutor 已有的实验性 TypeScript Chat Engine。DeepTutor Lite 提供基于 Pi Agent Core / Pi AI 的独立 TypeScript CLI 实现，可用于研究通用 Agent Loop、模型接入、Tool 注册、Skills / Prompts 装配及会话恢复的替代方案；其 Node.js 运行时与 Ink TUI 不直接适用于移动端。此处是技术评估方向，**尚未确定实现，也尚未完成可运行客户端**。

## 上游项目与参考关系

| 项目 | 仓库 | 参考重点 |
| --- | --- | --- |
| DeepTutor | [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) | LF01 / LF02 的业务行为、学习状态模型、Agent / Tool 接口 |
| DeepTutor Lite | [leonyvon/deeptutor-lite](https://github.com/leonyvon/deeptutor-lite) | Pi Harness 轻量化装配、Skills / Prompts 与 Tools 封装、LF01 对话交互及 LF02 最小实现 |
| Cherry Studio Mobile | [CherryHQ/cherry-studio-app](https://github.com/CherryHQ/cherry-studio-app) | React Native / Expo、移动端进程内 Pi Agent Runtime、SQLite、原生工具 |
| Cherry Studio Desktop | [CherryHQ/cherry-studio](https://github.com/CherryHQ/cherry-studio) | 跨平台架构与桌面端实现参考 |

本仓库是**独立项目**，不是上述仓库的 Fork。DeepTutor、DeepTutor Lite 与 Cherry Studio Mobile 作为 **Git Submodule** 固定到指定上游提交，仅供源码对照和后续迁移研究；Cherry Studio Desktop 保留链接参考。后续实际复用代码时，仍需遵循相应许可证与归属要求。

DeepTutor Lite 仅作为轻量化提取参考，不是 Learn Pace 的运行时依赖，也不作为学习业务的权威基线：LF01 可参考其 [Harness](https://github.com/leonyvon/deeptutor-lite/blob/main/src/agent/harness.ts)、[Skills / Prompts](https://github.com/leonyvon/deeptutor-lite/blob/main/src/agent/resources.ts) 与交互式提问/恢复机制；LF02 可参考其 [Mastery Tools](https://github.com/leonyvon/deeptutor-lite/blob/main/src/tools/mastery.ts) 的封装方式，但学习证据、掌握门槛、状态推进及复习规则仍以官方 DeepTutor 的 Learning Domain 和测试为业务基线。移动端运行时与原生适配继续以 Cherry Studio Mobile 为工程参考。

### 上游源码 Submodule

| 本地路径 | 上游 | 用途 |
| --- | --- | --- |
| `upstream/deeptutor` | [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) | LF01/LF02 学习流程、领域模型、Agent 与工具源码 |
| `upstream/deeptutor-lite` | [leonyvon/deeptutor-lite](https://github.com/leonyvon/deeptutor-lite) | Pi Agent Core / Pi AI、轻量 Harness、Skills / Tools、LF01 / LF02 提取参考 |
| `upstream/cherry-studio-mobile` | [CherryHQ/cherry-studio-app](https://github.com/CherryHQ/cherry-studio-app) | React Native / Expo、Pi Durable、本地数据和移动构建参考 |

首次克隆（包含子模块）：

```bash
git clone --recurse-submodules https://github.com/kms9/learn-pace.git
```

已有克隆初始化子模块：

```bash
git submodule update --init --recursive
```

需要评估上游更新时手动推进引用并审阅差异：

```bash
git submodule update --remote -- upstream/deeptutor upstream/deeptutor-lite upstream/cherry-studio-mobile
git status
# 确认上游变化后，另行提交子模块指针更新。
```

子模块是 **gitlink（mode 160000）**，主仓库记录的是上游 Commit SHA，并不把各上游项目的全部源码复制到主仓库。首次克隆会下载对应源码，体积和耗时取决于上游仓库及其历史；不需要源码时可以先普通 `git clone`，再按需初始化子模块。

## 产品设计文档（V0.2）

- [产品需求文档与索引](docs/prd/README.md)：P0、LF01/LF02、页面、领域模型、运行时、数据流、持久化及验收。
- [原型设计](docs/design/README.md)：V0.1 原型校验、V0.2 12 组 / 41 状态的自包含 HTML。
- [学习闭环复评](docs/evaluation/learning-loop-review-v0.2.md)：主路径已具备设计覆盖；异常交互及真实工程验证仍待完成。
- [实施路线与 Gate](docs/roadmap.md)。
- [可行性评估与实施方案](docs/evaluation/feasibility-and-plan-v0.2.md)：上游许可证/Runtime 核对、风险与 M0–M3 实施计划。

当前基线为拟议设计 V0.2，尚待产品评审冻结；原始 PNG 待补传，不视为已同步。三个上游源码引用保持不变。

## 当前阶段与下一步

**状态：M0 产品设计评审 / M1 技术验证准备（尚无应用实现）。**

- [ ] 梳理 LF01 的交互流程、Agent 边界、会话数据及异常/恢复语义。
- [ ] 梳理 LF02 的学习状态机、学习证据、掌握门槛及复习调度规则。
- [ ] 为 LF01/LF02 建立来源可追溯的业务契约和最小验收用例。
- [ ] 在上述契约稳定后验证移动端 Runtime 与本地持久化方案。

**本阶段不做**：全部 DeepTutor 功能迁移、重型素材解析、内建 RAG 引擎、视频/动画生成、插件市场、课程市场或模型本地推理。

---

> 业务参考归属上游项目；Learn Pace 的范围、设计与实现以本仓库后续提交为准。
