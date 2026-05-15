import Database from 'better-sqlite3'

export function createTestDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workdir TEXT NOT NULL,
    model TEXT,
    name TEXT,
    mode TEXT NOT NULL DEFAULT 'chat',
    started_at INTEGER NOT NULL,
    last_used INTEGER,
    ended_at INTEGER,
    claude_session_id TEXT,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    working_time_ms INTEGER NOT NULL DEFAULT 0,
    terminal_scrollback TEXT,
    cost_usd REAL,
    api_duration_ms INTEGER,
    lines_added INTEGER,
    lines_removed INTEGER,
    context_input_tokens INTEGER,
    context_output_tokens INTEGER,
    context_window_size INTEGER,
    context_pct REAL,
    effort_level TEXT,
    thinking_enabled INTEGER,
    rate_limit_5h_pct REAL,
    rate_limit_5h_resets_at INTEGER,
    rate_limit_7d_pct REAL,
    rate_limit_7d_resets_at INTEGER
  )`).run()

  db.prepare(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content TEXT NOT NULL, tokens INTEGER, created_at INTEGER NOT NULL
  )`).run()

  db.prepare(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`).run()

  db.prepare(`CREATE TABLE IF NOT EXISTS usage_cache (
    date TEXT PRIMARY KEY,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    cached_at INTEGER NOT NULL
  )`).run()

  return db
}
