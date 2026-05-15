import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_DIR = process.env.DATA_DIR ?? path.join(process.env.HOME ?? '/root', '.claude', 'webui')
const DB_PATH = path.join(DB_DIR, 'webui.db')

function initDb(): Database.Database {
  fs.mkdirSync(DB_DIR, { recursive: true })
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workdir TEXT NOT NULL,
      model TEXT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )
  `).run()

  db.prepare(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      tokens INTEGER,
      created_at INTEGER NOT NULL
    )
  `).run()

  db.prepare(`
    CREATE TABLE IF NOT EXISTS usage_cache (
      date TEXT PRIMARY KEY,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL CHECK(source IN ('local', 'api', 'merged')),
      cached_at INTEGER NOT NULL
    )
  `).run()

  db.prepare(`
    CREATE TABLE IF NOT EXISTS oauth_cache (
      key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    )
  `).run()

  // Migrate: add claude_session_id to sessions if missing
  const sessionCols = db.pragma('table_info(sessions)') as Array<{ name: string }>
  if (!sessionCols.find((c) => c.name === 'claude_session_id')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN claude_session_id TEXT').run()
  }

  if (!sessionCols.find((c) => c.name === 'name')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN name TEXT').run()
  }

  if (!sessionCols.find((c) => c.name === 'total_tokens')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0').run()
  }

  if (!sessionCols.find((c) => c.name === 'working_time_ms')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN working_time_ms INTEGER NOT NULL DEFAULT 0').run()
  }

  if (!sessionCols.find((c) => c.name === 'mode')) {
    db.prepare("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'").run()
  }

  if (!sessionCols.find((c) => c.name === 'terminal_scrollback')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN terminal_scrollback TEXT').run()
  }

  if (!sessionCols.find((c) => c.name === 'cost_usd')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN cost_usd REAL').run()
  }

  if (!sessionCols.find((c) => c.name === 'api_duration_ms')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN api_duration_ms INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'lines_added')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN lines_added INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'lines_removed')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN lines_removed INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'context_input_tokens')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN context_input_tokens INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'context_output_tokens')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN context_output_tokens INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'context_window_size')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN context_window_size INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'context_pct')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN context_pct REAL').run()
  }

  if (!sessionCols.find((c) => c.name === 'effort_level')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN effort_level TEXT').run()
  }

  if (!sessionCols.find((c) => c.name === 'thinking_enabled')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN thinking_enabled INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'rate_limit_5h_pct')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN rate_limit_5h_pct REAL').run()
  }

  if (!sessionCols.find((c) => c.name === 'rate_limit_5h_resets_at')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN rate_limit_5h_resets_at INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'rate_limit_7d_pct')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN rate_limit_7d_pct REAL').run()
  }

  if (!sessionCols.find((c) => c.name === 'rate_limit_7d_resets_at')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN rate_limit_7d_resets_at INTEGER').run()
  }

  if (!sessionCols.find((c) => c.name === 'last_used')) {
    db.prepare('ALTER TABLE sessions ADD COLUMN last_used INTEGER').run()
  }
  // Back-fill last_used for rows that predate the column — use started_at as a reasonable default.
  db.prepare('UPDATE sessions SET last_used = started_at WHERE last_used IS NULL').run()

  // On startup, mark any sessions that were still "active" (ended_at NULL) as ended now.
  // PTY processes don't survive a server restart, so leaving ended_at NULL would make
  // them show as active in the UI forever.
  db.prepare('UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL').run(Date.now())

  db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `).run()

  return db
}

export const db = initDb()
