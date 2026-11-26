# local-storage Specification

## Purpose

定义 Learn Pace 在单设备本地优先架构下的 SQLite 持久化基础能力（WAL 模式、版本化 Schema 迁移与顺序读写 Repository 契约），支撑 M2-A 阶段的设置、自由问答会话、Little Tutor 子会话、学习路径与待答题卡落库，并在 Node 与 Android 环境中具备一致行为。

## Requirements

### Requirement: SQLite WAL mode and versioned schema migration
本地数据库 `learn-pace.db` SHALL 使用 SQLite WAL 日志模式，MUST 幂等初始化或升级到版本 6。升级在原子事务中添加支持软删除的 `knowledge_cards`，保留 M1、M2-A 和 M2-B 既有数据。

#### Scenario: Opening a fresh database
- **WHEN** 应用首次打开空的 `learn-pace.db`
- **THEN** 数据库启用 `WAL` 日志模式并创建 `settings`、`learning_progress`（含 `version`）、`interactions`（含 `submission_id` 唯一索引）、`sessions`、`messages`、`session_threads`、`domain_events` 与 `knowledge_cards` 表及必要索引
- **AND** 记录最新 Schema 版本号（v6）

#### Scenario: Upgrading an existing M1 database
- **WHEN** 应用打开已包含 M1 `learning_progress`、`interactions`、`settings` 数据的既有 `learn-pace.db`
- **THEN** 迁移流程平滑补齐新增表与扩展字段，既有路径进度、待答题卡与设置记录保持完整可读

#### Scenario: Upgrading an existing M2-A v4 database to v5
- **WHEN** 应用打开已包含 M2-A v4 路径、会话、消息、侧聊与题卡数据的 `learn-pace.db`
- **THEN** 迁移流程从 `progress` JSON 回填 `learning_progress.version`，补齐 `domain_events` 表与 `submission_id` 唯一索引，既有数据完整可读

#### Scenario: Upgrading an existing M2-B v5 database to v6 with rollback on failure
- **WHEN** 应用打开 M2-B v5 数据库升级至 v6，或在迁移中途注入故障
- **THEN** 正常升级后 `knowledge_cards` 就绪且全部 v5 数据完整可读；若迁移失败则事务完整回滚，库版本与原数据保持 v5 不变

### Requirement: Sequential persistence repositories for core M2-A entities
存储层 SHALL 为设置、学习路径、交互（含已判分查询）、会话、消息、小老师、领域事件和知识卡提供纯 TypeScript 仓储契约及内存、Expo SQLite 实现，支持原子短事务 `runInTransaction`、CAS 保存 `saveWithCas` 以及跨连接串行写入。

#### Scenario: Persisting and reloading sessions, messages, and threads
- **WHEN** 调用方通过 Repository 写入一条会话、关联消息以及锚定到指定消息的小老师侧聊后重新读取
- **THEN** 内存实现与 SQLite 实现返回结构一致的会话列表、按时间排序的消息流及侧聊锚点元数据（`parent_session_id`、`source_message_id`、`selected_text`、选区起止、解除关联时间）

#### Scenario: Deleting messages and side chats
- **WHEN** 调用方删除一轮问答的两条消息，或删除一个侧聊
- **THEN** 两种实现都不再返回被删除的消息或侧聊，其余记录保持不变

#### Scenario: Persisting path metadata alongside aggregate progress
- **WHEN** 调用方保存学习路径进度（含路径名称、状态与更新时间）并查询路径列表或汇总计数
- **THEN** 存储层能够按最近更新时间列出路径，并准确返回已存储的路径与未完成交互记录

#### Scenario: Atomic transaction rolls back on failure
- **WHEN** 调用方在 `runInTransaction` 中先写入更新后的路径进度，随后在更新题卡前抛出错误
- **THEN** 内存实现与 SQLite 实现均完整回滚该事务，路径进度与题卡保持事务开始前的原状

#### Scenario: Listing graded interactions and managing knowledge cards
- **WHEN** 调用方查询所有已批改题卡，或写入、更新、搜索、软删除与解绑知识卡
- **THEN** 内存实现与 SQLite 实现返回一致的已批改题卡与知识卡记录

### Requirement: Persistence survives application process termination
Data written through the SQLite store SHALL remain intact after the Android application process is force-stopped and relaunched.

#### Scenario: Force-stop recovery check
- **WHEN** 用户保存模型非敏感配置并完成一轮问答后强杀应用进程并重新启动
- **THEN** 重启后的应用从 `learn-pace.db` 读回相同的配置状态与会话消息
