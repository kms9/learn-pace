interface MigrationDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  getAllAsync<T>(sql: string): Promise<T[]>;
}

const schemaVersion = 2;

export async function migrateLearningDatabase(db: MigrationDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL");
  const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
  if (version > schemaVersion) throw new Error("数据库版本高于当前应用支持的版本");
  if (version === schemaVersion) return;

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS learning_progress (
      path_id TEXT PRIMARY KEY NOT NULL,
      progress TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS interactions (
      interaction_id TEXT PRIMARY KEY NOT NULL,
      path_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('awaiting_input', 'answered', 'graded')),
      question TEXT NOT NULL,
      raw_answer TEXT,
      submission_id TEXT,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS interactions_by_path ON interactions (path_id, updated_at);
    CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  `);

  const columns = new Set((await db.getAllAsync<{ name: string }>("PRAGMA table_info(learning_progress)"))
    .map(({ name }) => name));
  if (!columns.has("status")) {
    await db.execAsync("ALTER TABLE learning_progress ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!columns.has("name")) {
    await db.execAsync("ALTER TABLE learning_progress ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.has("updated_at")) {
    await db.execAsync("ALTER TABLE learning_progress ADD COLUMN updated_at REAL NOT NULL DEFAULT 0");
  }

  await db.execAsync(`
    UPDATE learning_progress
    SET name = CASE WHEN json_type(progress, '$.name') = 'text'
                    THEN json_extract(progress, '$.name') ELSE '' END,
        updated_at = CASE WHEN json_type(progress, '$.updated_at') IN ('integer', 'real')
                          THEN json_extract(progress, '$.updated_at') ELSE 0 END
    WHERE json_valid(progress);
    CREATE INDEX IF NOT EXISTS learning_progress_by_update ON learning_progress (updated_at DESC, path_id);
    CREATE INDEX IF NOT EXISTS interactions_open_by_update
      ON interactions (updated_at DESC, interaction_id)
      WHERE status IN ('awaiting_input', 'answered');

    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      path_id TEXT,
      mode TEXT,
      title TEXT NOT NULL,
      model_id TEXT,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_by_update ON sessions (updated_at DESC, session_id);
    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY NOT NULL,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      turn_id TEXT,
      metadata TEXT,
      created_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS messages_by_session ON messages (session_id, created_at, message_id);
    CREATE TABLE IF NOT EXISTS session_threads (
      thread_id TEXT PRIMARY KEY NOT NULL,
      parent_session_id TEXT NOT NULL,
      source_message_id TEXT NOT NULL,
      selected_text TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at REAL NOT NULL,
      updated_at REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS threads_by_parent
      ON session_threads (parent_session_id, created_at, thread_id);
    PRAGMA user_version = ${schemaVersion};
  `);
}
