# 06 · Agent Runtime 契约

> V0.2 拟议产品设计基线（2026-11-24）。源自 PRD V0.1 和 V0.2 闭环复评；非已实现功能或已通过工程验收。遇到 V0.1 原型与 V0.2 约束冲突，以 V0.2 为拟议修订基线。参见 [复评](../evaluation/learning-loop-review-v0.2.md) 与 [设计索引](../design/README.md)。

## 8. 技术架构、业务服务与数据流

### 8.1 客户端内运行架构（候选）

React Native / Expo UI → Local Application Host → Agent Runtime Adapter（候选 Pi Durable）→ 外部 LLM API。Agent Tools 通过应用端口访问 Learning Domain、Session、Source 等服务。Domain 通过 Repository 访问 SQLite；文件走 App Sandbox，密钥走 SecureStore。外部检索/素材解析为可选 Tools，不是 P0 强制业务后端。

| 层级 | 责任 | 关键边界 |
| --- | --- | --- |
| Presentation | 4 Tab、页面、流式消息、题卡、交互状态 | UI 仅提交命令与展示已提交投影 |
| Application | Session、Turn Coordinator、Learning Application、Recovery | 绑定当前 path/mode/session，权限、幂等、事务编排 |
| Agent Runtime | 模型接入、上下文、工具循环、取消、事件 | 不拥有掌握判定权；替换 Runtime 不改变领域契约 |
| Learning Domain | Path/Objective、Assessment、Evidence、Policy、Scheduler | 纯业务规则不依赖 Pi 或 RN；状态必须有证据和回执 |
| Infrastructure | SQLite、FileSystem、SecureStore、网络 | 本地权威数据、可替换外部能力 |



### 8.3 上游复用策略

- DeepTutor 官方：提取 LF01/LF02 业务语义、学习模型、模式准入、题卡/证据/调度及测试；不照搬整个 Python/Web 后端。
- DeepTutor Lite：参考 Pi Harness、Skills、Tools、会话恢复，不能直接继承其不完整的掌握门禁和复习逻辑，也不把 Node/Ink 代码直接装入 RN。
- Cherry Studio Mobile：参考 Pi Durable、原生适配、SQLite、事件投影、Expo/Metro/EAS；验证许可证及依赖兼容性。最终 Runtime 选型以移动端 PoC 为门槛，而非预先承诺。

## Runtime 与领域的分界
同一 Runtime 执行 LF01/LF02，Host 提供受信任的路径、模式和工具准入；LF02 每轮注入最新状态，题卡登记成功后结束本轮，下一轮先读已保存答案。Agent 的计划、工具调用和 LLM 定性判断不拥有掌握写入权。运行时替换不得丢失业务记录；Pi Durable/Expo 尚待真机 PoC。
