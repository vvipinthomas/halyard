-- HALYARD schema (SQLite / Cloudflare D1)
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL,
  settings TEXT NOT NULL DEFAULT '{}'           -- value model: hourlyRate, currency
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  ip TEXT, user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE, prefix TEXT NOT NULL, created_at INTEGER NOT NULL,
  last_used_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0
);
-- Workspace items: agents, flows, skills, mcp, contexts, knowledge, memory
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL,
  name TEXT NOT NULL, body TEXT NOT NULL, source_id TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_org_kind ON items(org_id, kind, deleted);
CREATE TABLE IF NOT EXISTS item_versions (
  item_id TEXT NOT NULL, version INTEGER NOT NULL, body TEXT NOT NULL,
  changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL, PRIMARY KEY (item_id, version)
);
-- Encrypted provider credentials (AES-256-GCM)
CREATE TABLE IF NOT EXISTS secrets (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL, iv TEXT NOT NULL, base_url TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (org_id, provider)
);
-- Usage and value metering
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
  target_kind TEXT NOT NULL, target_id TEXT NOT NULL, target_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded','failed','rejected','cancelled')),
  provider TEXT, model TEXT, steps INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
  outputs INTEGER NOT NULL DEFAULT 0, output_chars INTEGER NOT NULL DEFAULT 0,
  minutes_saved_est REAL NOT NULL DEFAULT 0, accepted INTEGER, rating INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_org_time ON runs(org_id, created_at);
-- Append-only, hash-chained audit log (tamper evidence)
CREATE TABLE IF NOT EXISTS audit_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT, user_id TEXT,
  action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT,
  at INTEGER NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, reset_at INTEGER NOT NULL);
