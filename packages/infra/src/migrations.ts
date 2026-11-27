interface MigrationDatabase {
  execAsync(sql: string): Promise<void>;
  getFirstAsync<T>(sql: string): Promise<T | null>;
  getAllAsync<T>(sql: string): Promise<T[]>;
}

export const databaseSchemaVersion = 9;

export async function migrateLearningDatabase(db: MigrationDatabase): Promise<void> {
  await db.execAsync("PRAGMA journal_mode = WAL");
  const version = (await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0;
  if (version > databaseSchemaVersion) throw new Error("数据库版本高于当前应用支持的版本");
  if (version === databaseSchemaVersion) return;

  if (version < 2) await migrateV2(db);
  if (version < 3) await migrateV3(db);
  if (version < 4) await migrateV4(db);
  if (version < 5) await migrateV5(db);
  if (version < 6) await migrateV6(db);
  if (version < 7) await migrateV7(db);
  if (version < 8) await migrateV8(db);
  await migrateV9(db);
}

function skillTableSchema(name: "skills" | "skills_v9"): string {
  const registry = name === "skills_v9" ? ", 'registry'" : "";
  return `CREATE TABLE IF NOT EXISTS ${name} (
    skill_id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('local_file', 'local_zip', 'github'${registry})),
    origin_locator TEXT NOT NULL,
    source_url TEXT,
    pinned_ref TEXT,
    active_revision TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    user_invocable INTEGER NOT NULL DEFAULT 1 CHECK (user_invocable IN (0, 1)),
    disable_model_invocation INTEGER NOT NULL DEFAULT 0 CHECK (disable_model_invocation IN (0, 1)),
    compatibility_json TEXT NOT NULL,
    metadata_json TEXT NOT NULL,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
  );`;
}

async function migrateV9(db: MigrationDatabase): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.execAsync(`
      ${skillTableSchema("skills_v9")}
      INSERT INTO skills_v9 SELECT * FROM skills;
      DROP TABLE skills;
      ALTER TABLE skills_v9 RENAME TO skills;
      CREATE UNIQUE INDEX skills_origin_unique ON skills (origin_kind, origin_locator);
      PRAGMA user_version = 9;
    `);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function migrateV8(db: MigrationDatabase): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS provider_connections (
        connection_id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('ima')),
        display_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('disconnected', 'ready', 'auth_denied', 'error')),
        credential_ref TEXT,
        last_error TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_bindings (
        binding_id TEXT PRIMARY KEY NOT NULL,
        connection_id TEXT NOT NULL,
        provider TEXT NOT NULL CHECK (provider IN ('ima')),
        remote_kb_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        base_type TEXT NOT NULL DEFAULT '',
        role_type TEXT NOT NULL DEFAULT '',
        writable INTEGER NOT NULL DEFAULT 0 CHECK (writable IN (0, 1)),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS source_bindings_connection_kb_unique
        ON source_bindings (connection_id, remote_kb_id);
      CREATE INDEX IF NOT EXISTS source_bindings_by_connection ON source_bindings (connection_id, updated_at DESC);
      PRAGMA user_version = 8;
    `);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function migrateV7(db: MigrationDatabase): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.execAsync(`
      ${skillTableSchema("skills")}
      CREATE UNIQUE INDEX IF NOT EXISTS skills_origin_unique
        ON skills (origin_kind, origin_locator);
      CREATE TABLE IF NOT EXISTS skill_revisions (
        skill_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        manifest_json TEXT NOT NULL,
        files_json_base64 TEXT NOT NULL,
        raw_bytes INTEGER NOT NULL,
        instructions_chars INTEGER NOT NULL,
        created_at REAL NOT NULL,
        PRIMARY KEY (skill_id, revision)
      );
      CREATE INDEX IF NOT EXISTS skill_revisions_by_skill
        ON skill_revisions (skill_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS skill_bindings (
        skill_id TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('lf01', 'little_tutor')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        updated_at REAL NOT NULL,
        PRIMARY KEY (skill_id, scope)
      );
      CREATE INDEX IF NOT EXISTS skill_bindings_by_scope
        ON skill_bindings (scope, enabled, skill_id);
      PRAGMA user_version = 7;
    `);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function migrateV6(db: MigrationDatabase): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS knowledge_cards (
        card_id TEXT PRIMARY KEY NOT NULL,
        source_kind TEXT NOT NULL CHECK (source_kind IN ('chat', 'little_tutor', 'mastery_card')),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        path_id TEXT,
        source_session_id TEXT,
        source_message_id TEXT,
        source_interaction_id TEXT,
        created_at REAL NOT NULL,
        updated_at REAL NOT NULL,
        deleted_at REAL
      );
      CREATE INDEX IF NOT EXISTS knowledge_cards_active_by_update
        ON knowledge_cards (updated_at DESC, card_id) WHERE deleted_at IS NULL;
      PRAGMA user_version = 6;
    `);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function migrateV5(db: MigrationDatabase): Promise<void> {
  await db.execAsync("BEGIN IMMEDIATE");
  try {
    const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(learning_progress)");
    if (!columns.some(({ name }) => name === "version")) {
      await db.execAsync("ALTER TABLE learning_progress ADD COLUMN version INTEGER NOT NULL DEFAULT 0");
    }
    await db.execAsync(`
      UPDATE learning_progress
      SET version = CAST(COALESCE(json_extract(progress, '$.version'), 0) AS INTEGER)
      WHERE json_valid(progress);

      WITH ranked_submissions AS (
        SELECT interaction_id, ROW_NUMBER() OVER (
          PARTITION BY submission_id ORDER BY updated_at DESC, interaction_id DESC
        ) AS rank
        FROM interactions WHERE submission_id IS NOT NULL
      )
      UPDATE interactions SET submission_id = NULL
      WHERE interaction_id IN (SELECT interaction_id FROM ranked_submissions WHERE rank > 1);

      CREATE UNIQUE INDEX IF NOT EXISTS interactions_submission_unique
        ON interactions (submission_id) WHERE submission_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS domain_events (
        event_id TEXT PRIMARY KEY NOT NULL,
        path_id TEXT NOT NULL,
        session_id TEXT,
        turn_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS domain_events_by_path ON domain_events (path_id, created_at DESC, event_id);
      PRAGMA user_version = 5;
    `);
    await db.execAsync("COMMIT");
  } catch (error) {
    await db.execAsync("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function migrateV3(db: MigrationDatabase): Promise<void> {
  const threadColumns = new Set((await db.getAllAsync<{ name: string }>("PRAGMA table_info(session_threads)"))
    .map(({ name }) => name));
  const newColumns = { selection_start: "INTEGER", selection_end: "INTEGER", detached_at: "REAL" };
  for (const [name, type] of Object.entries(newColumns)) {
    if (!threadColumns.has(name)) await db.execAsync(`ALTER TABLE session_threads ADD COLUMN ${name} ${type}`);
  }
  await db.execAsync("PRAGMA user_version = 3");
}

async function migrateV4(db: MigrationDatabase): Promise<void> {
  const current = await db.getFirstAsync<{ sql: string }>("SELECT sql FROM sqlite_schema WHERE name = 'interactions'");
  if (!current?.sql.includes("'abandoned'")) {
    await db.execAsync(`CREATE TABLE IF NOT EXISTS interactions_v4 (
      interaction_id TEXT PRIMARY KEY NOT NULL, path_id TEXT NOT NULL,
      session_id TEXT NOT NULL, turn_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('awaiting_input', 'answered', 'graded', 'abandoned')),
      question TEXT NOT NULL, raw_answer TEXT, submission_id TEXT, updated_at REAL NOT NULL
    )`);
    if (current) {
      await db.execAsync(`INSERT OR REPLACE INTO interactions_v4
        (interaction_id, path_id, session_id, turn_id, status, question, raw_answer, submission_id, updated_at)
        SELECT interaction_id, path_id, session_id, turn_id, status, question, raw_answer, submission_id, updated_at
        FROM interactions`);
      await db.execAsync("DROP TABLE interactions");
    }
    await db.execAsync("ALTER TABLE interactions_v4 RENAME TO interactions");
  }
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS interactions_by_path ON interactions (path_id, updated_at);
    CREATE INDEX IF NOT EXISTS interactions_open_by_update ON interactions (updated_at DESC, interaction_id)
      WHERE status IN ('awaiting_input', 'answered');
    PRAGMA user_version = 4;
  `);
}

async function migrateV2(db: MigrationDatabase): Promise<void> {
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
    PRAGMA user_version = 2;
  `);
}
