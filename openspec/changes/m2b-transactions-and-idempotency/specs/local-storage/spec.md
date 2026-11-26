# Spec Delta

## MODIFIED Requirements

### Requirement: SQLite WAL mode and versioned schema migration
The local database `learn-pace.db` SHALL open in SQLite WAL journal mode and MUST initialize or upgrade its schema idempotently to version 5 (`learning_progress.version`, unique non-null `interactions.submission_id`, and `domain_events`) without losing previously stored M1 or M2-A records.

#### Scenario: Opening a fresh database
- **WHEN** 应用首次打开空的 `learn-pace.db`
- **THEN** 数据库启用 `WAL` 日志模式并创建 `settings`、`learning_progress`（含 `version`）、`interactions`（含 `submission_id` 唯一索引）、`sessions`、`messages`、`session_threads` 与 `domain_events` 表及必要索引
- **AND** 记录最新 Schema 版本号（v5）

#### Scenario: Upgrading an existing M1 database
- **WHEN** 应用打开已包含 M1 `learning_progress`、`interactions`、`settings` 数据的既有 `learn-pace.db`
- **THEN** 迁移流程平滑补齐新增表与扩展字段，既有路径进度、待答题卡与设置记录保持完整可读

#### Scenario: Upgrading an existing M2-A v4 database to v5
- **WHEN** 应用打开已包含 M2-A v4 路径、会话、消息、侧聊与题卡数据的 `learn-pace.db`
- **THEN** 迁移流程从 `progress` JSON 回填 `learning_progress.version`，补齐 `domain_events` 表与 `submission_id` 唯一索引，既有数据完整可读

### Requirement: Sequential persistence repositories for core M2-A entities
The storage layer SHALL expose pure-TypeScript repository contracts and both in-memory and Expo SQLite implementations for settings, learning paths, interactions, chat sessions, messages, Little Tutor threads, and domain events, supporting both direct operations and atomic short transactions (`runInTransaction`) with CAS-guarded progress saves (`saveWithCas`), and serializing all writes so that a transaction on a separate connection never causes concurrent writes to fail with a lock error.

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
