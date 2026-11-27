# Spec Delta

## MODIFIED Requirements

### Requirement: SQLite WAL mode and versioned schema migration
本地数据库 `learn-pace.db` SHALL 使用 SQLite WAL 日志模式，MUST 幂等初始化或升级到版本 9。v8 添加外部知识库表，v9 在原子事务中扩展技能来源并保留既有学习数据、技能修订、绑定和知识库数据，迁移中途失败时 MUST 完整回滚并保持原版本号与数据不变。

#### Scenario: Opening a fresh database
- **WHEN** 应用首次打开空的 `learn-pace.db`
- **THEN** 数据库启用 `WAL` 日志模式并创建 `settings`、`learning_progress`（含 `version`）、`interactions`（含 `submission_id` 唯一索引）、`sessions`、`messages`、`session_threads`、`domain_events`、`knowledge_cards`、`skills`、`skill_revisions`、`skill_bindings`、`provider_connections` 与 `source_bindings` 共 13 张表及必要索引
- **AND** 记录最新 Schema 版本号（v9）

#### Scenario: Upgrading an existing M1 database
- **WHEN** 应用打开已包含 M1 `learning_progress`、`interactions`、`settings` 数据的既有 `learn-pace.db`
- **THEN** 迁移流程平滑补齐至 v9 全部新增表与扩展字段，既有路径进度、待答题卡与设置记录保持完整可读

#### Scenario: Upgrading an existing M2-A v4 database to v5
- **WHEN** 应用打开已包含 M2-A v4 路径、会话、消息、侧聊与题卡数据的 `learn-pace.db`
- **THEN** 迁移流程从 `progress` JSON 回填 `learning_progress.version`，补齐 `domain_events` 表与 `submission_id` 唯一索引并平滑升级至 v9，既有数据完整可读

#### Scenario: Upgrading an existing M2-B v5 database to v6 with rollback on failure
- **WHEN** 应用打开 M2-B v5 数据库升级至 v6，或在迁移中途注入故障
- **THEN** 正常升级后 `knowledge_cards` 就绪且全部 v5 数据完整可读；若迁移失败则事务完整回滚，库版本与原数据保持 v5 不变

#### Scenario: Upgrading an existing M2-C v6 database to v7 with rollback on failure
- **WHEN** 应用打开 M2-C v6 数据库（含 `knowledge_cards`）升级至 v7，或在 `migrateV7` 中途注入故障
- **THEN** 正常升级后 `skills`、`skill_revisions` 与 `skill_bindings` 表及索引全部就绪且全部 v6 数据完整可读；若迁移失败则事务完整回滚，库版本与原数据保持 v6 不变

#### Scenario: Upgrading an existing M2-D v7 database to v8 with rollback on failure
- **WHEN** 应用打开 M2-D v7 数据库（含 Skill 表）升级至 v8，或在 `migrateV8` 中途注入故障
- **THEN** 正常升级后 `provider_connections` 与 `source_bindings` 表及索引全部就绪且全部 v7 数据完整可读；若迁移失败则事务完整回滚，库版本与原数据保持 v7 不变

#### Scenario: Upgrading a v8 database with installed skills
- **WHEN** 应用打开含已安装技能与已绑定知识库的 v8 数据库，或在 v9 迁移中途发生故障
- **THEN** 正常升级后保留每个已有来源和修订，支持保存市场包来源。迁移失败时原表和版本号完整回滚
