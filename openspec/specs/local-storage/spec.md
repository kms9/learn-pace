# local-storage Specification

## Purpose

定义 Learn Pace 在单设备本地优先架构下的 SQLite 持久化基础能力（WAL 模式、版本化 Schema 迁移与顺序读写 Repository 契约），支撑 M2-A 阶段的设置、自由问答会话、Little Tutor 子会话、学习路径与待答题卡落库，并在 Node 与 Android 环境中具备一致行为。

## Requirements

### Requirement: SQLite WAL mode and versioned schema migration
The local database `learn-pace.db` SHALL open in SQLite WAL journal mode and MUST initialize or upgrade its schema idempotently using a tracked schema version without losing previously stored M1 records (`learning_progress`, `interactions`, `settings`).

#### Scenario: Opening a fresh database
- **WHEN** 应用首次打开空的 `learn-pace.db`
- **THEN** 数据库启用 `WAL` 日志模式并创建 `settings`、`learning_progress`、`interactions`、`sessions`、`messages`、`session_threads` 表及必要索引
- **AND** 记录最新 Schema 版本号

#### Scenario: Upgrading an existing M1 database
- **WHEN** 应用打开已包含 M1 `learning_progress`、`interactions`、`settings` 数据的既有 `learn-pace.db`
- **THEN** 迁移流程平滑补齐新增表与扩展字段，既有路径进度、待答题卡与设置记录保持完整可读

### Requirement: Sequential persistence repositories for core M2-A entities
The storage layer SHALL expose pure-TypeScript repository contracts and both in-memory and Expo SQLite implementations for settings, learning paths, interactions, chat sessions, messages, and Little Tutor threads, using straightforward sequential reads and writes in M2-A without requiring multi-table SQLite transaction locks.

#### Scenario: Persisting and reloading sessions, messages, and threads
- **WHEN** 调用方通过 Repository 写入一条会话、关联消息以及锚定到指定消息的 Little Tutor 子会话后重新读取
- **THEN** 内存实现与 SQLite 实现返回结构一致的会话列表、按时间排序的消息流及子会话锚点元数据（`parent_session_id`、`source_message_id`、`selected_text`）

#### Scenario: Persisting path metadata alongside aggregate progress
- **WHEN** 调用方保存学习路径进度（含路径名称、状态与更新时间）并查询路径列表或汇总计数
- **THEN** 存储层能够按最近更新时间列出路径，并准确返回已存储的路径与未完成交互记录

### Requirement: Persistence survives application process termination
Data written through the SQLite store SHALL remain intact after the Android application process is force-stopped and relaunched.

#### Scenario: Force-stop recovery check
- **WHEN** 用户在应用中保存场景偏好或模型非敏感配置后强杀应用进程并重新启动
- **THEN** 重启后的应用从 `learn-pace.db` 读回相同的场景偏好与配置状态
