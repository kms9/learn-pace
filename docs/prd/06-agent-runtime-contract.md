# 06 · Agent Runtime 契约

> V0.2 拟议产品设计基线（2026-11-24），2026-11-25 按 [DeepTutor 手机版复刻方案](../evaluation/deeptutor-mobile-parity-plan-v0.3.md) 增补 §8.4 精通之路工具集。非已实现功能或已通过工程验收。

## 8. 技术架构、业务服务与数据流

### 8.1 客户端内运行架构

React Native / Expo UI → Local Application Host → Agent Runtime Adapter（采用最新版 Pi Durable）→ 外部 LLM API（首期仅需确保接入 DeepSeek Flash）。Agent Tools 通过应用端口访问 Learning Domain、Session、Source 等服务。Domain 通过 Repository 访问 SQLite；文件走 App Sandbox，密钥走 SecureStore。外部检索/素材解析为可选 Tools，不是 P0 强制业务后端。

| 层级 | 责任 | 关键边界 |
| --- | --- | --- |
| Presentation | 4 Tab、页面、流式消息、题卡、交互状态 | UI 仅提交命令与展示已提交投影 |
| Application | Session、Turn Coordinator、Learning Application、Recovery | 绑定当前 path/mode/session 与权限；主流程期先顺序落库，主流程完成后再统一补齐事务与幂等编排 |
| Agent Runtime | 模型接入（首期 DeepSeek Flash）、上下文、工具循环、取消、事件 | 不拥有掌握判定权；保留端口抽象，升级或替换 Runtime 不改变领域契约 |
| Learning Domain | Path/Objective、Assessment、Evidence、Policy、Scheduler | 纯业务规则不依赖 Pi 或 RN；状态必须有证据和回执 |
| Infrastructure | SQLite、FileSystem、SecureStore、网络 | 本地权威数据、可替换外部能力 |

### 8.3 上游复用策略

- DeepTutor 官方：提取 LF01/LF02 业务语义、学习模型、模式准入、题卡/证据/调度及测试；不照搬整个 Python/Web 后端。
- DeepTutor Lite：参考 Pi Harness、Skills、Tools、会话恢复，不能直接继承其不完整的掌握门禁和复习逻辑，也不把 Node/Ink 代码直接装入 RN。
- Cherry Studio Mobile：Learn Pace 为开源项目且已获 Cherry Studio App 作者明确授权，可直接复用和参考其 Pi Durable、RN/Hermes 原生适配、SQLite、事件投影、Expo/Metro/EAS 等可用代码与设计，并在此基础上升级适配至 Pi 最新版本（保留归属与许可证声明）。

## Runtime 与领域的分界
同一 Runtime（最新版 Pi Durable）执行 LF01/LF02，Host 提供受信任的路径、会话、模式和工具准入；LF02 每轮注入最新状态快照，题卡登记成功后结束本轮，下一轮先保存并批改已提交的答案。Agent 的计划、工具调用和 LLM 定性判断不拥有掌握写入权：掌握由领域规则根据评分结果判定。运行时升级或替换不得丢失业务记录。

### 8.4 精通之路工具集（V0.3，复刻 DeepTutor `deeptutor/capabilities/mastery/`）

工具一律挂载，执行时按会话模式校验，越权调用返回拒绝原因（同 DeepTutor `ensure_mode`）。导师提示词移植自 DeepTutor `prompts/zh/mastery_loop.yaml`（Apache-2.0，保留出处声明），删除本期不支持的知识库、PDF、视觉题段落。

| 工具 | 模式 | 作用 |
| --- | --- | --- |
| `mastery_status` | 全部 | 状态快照；每轮由 Host 预先注入 |
| `mastery_profile` | 全部 | 保存学习档案与教学偏好（先探查 / 先讲解） |
| `mastery_mode` | 全部 | 切换会话模式；进入学习模式要求大纲非空 |
| `read_source` | 全部 | 读取本路径的本地文本资料 |
| `mastery_build` | 编辑大纲 | 新建或整体替换大纲（按名称与类型保持知识点 ID） |
| `mastery_revise` | 编辑大纲 | 修订大纲：直接修改，或预览后凭预览号提交（校验基线版本） |
| `mastery_quiz` | 学习、复习 | 出题并结束本轮；复习模式只允许已掌握知识点 |
| `mastery_grade` | 学习、复习 | 批改当前待答题（学习者在输入框直接作答时使用） |
| `mastery_assess` | 学习、复习 | 定性评估，取学习者本轮原话；忽略模型给出的「通过」 |
| `mastery_note_explained` | 学习、复习 | 记录讲解覆盖，引文须来自本轮已展示的回复 |
| `mastery_defer_objective` | 学习、复习 | 延期知识点，不算掌握 |
| `mastery_skip_question` | 学习、复习 | 放弃当前题 |
| `mastery_repair_question` | 学习、复习 | 作废或更正有误的题与答案 |
| `mastery_topics`、`mastery_sessions` | 问答 | 只读列出路径与会话 |
| `mastery_open_session`、`mastery_new_session` | 问答 | 放置交接卡，不写数据、不自动跳转 |

首期只接 DeepSeek Flash。多工具导师循环在 Android 真机的稳定性、延迟与成本由技术验证 S7 先行验证（见[实施路线](../roadmap.md)）。
