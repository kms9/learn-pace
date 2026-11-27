# Spec Delta

## MODIFIED Requirements

### Requirement: Persistence survives application process termination
Data written through the SQLite store SHALL remain intact after the Android application process is force-stopped and relaunched.

#### Scenario: Force-stop recovery check
- **WHEN** 用户保存模型非敏感配置并完成一轮问答后强杀应用进程并重新启动
- **THEN** 重启后的应用从 `learn-pace.db` 读回相同的配置状态与会话消息

### Requirement: Sequential persistence repositories for core M2-A entities
The storage layer SHALL expose pure-TypeScript repository contracts and both in-memory and Expo SQLite implementations for settings, learning paths, interactions, chat sessions, messages, and Little Tutor threads (including selection range and detach state, and deletion of messages and threads), using straightforward sequential reads and writes in M2-A without requiring multi-table SQLite transaction locks.

#### Scenario: Persisting and reloading sessions, messages, and threads
- **WHEN** 调用方通过 Repository 写入一条会话、关联消息以及锚定到指定消息的小老师侧聊后重新读取
- **THEN** 内存实现与 SQLite 实现返回结构一致的会话列表、按时间排序的消息流及侧聊锚点元数据（`parent_session_id`、`source_message_id`、`selected_text`、选区起止、解除关联时间）

#### Scenario: Deleting messages and side chats
- **WHEN** 调用方删除一轮问答的两条消息，或删除一个侧聊
- **THEN** 两种实现都不再返回被删除的消息或侧聊，其余记录保持不变

#### Scenario: Persisting path metadata alongside aggregate progress
- **WHEN** 调用方保存学习路径进度（含路径名称、状态与更新时间）并查询路径列表或汇总计数
- **THEN** 存储层能够按最近更新时间列出路径，并准确返回已存储的路径与未完成交互记录
