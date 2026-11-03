-- Dark factory: products under agent operation, work items, timeline, usage budgets, sandbox worlds
CREATE TABLE IF NOT EXISTS factory_products (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
  config TEXT NOT NULL,                       -- JSON: mode, repo, cloudflare, sentry, model, policy
  paused INTEGER NOT NULL DEFAULT 0, hook_secret TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS factory_items (
  id TEXT PRIMARY KEY, org_id TEXT NOT NULL, product_id TEXT NOT NULL,
  source TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'medium', impact INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, risk INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}',            -- JSON: signal, diagnosis, patch summary, pr, deploy ids
  detected_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  merged_at INTEGER, deployed_at INTEGER, resolved_at INTEGER,
  UNIQUE (product_id, source, external_id)
);
CREATE INDEX IF NOT EXISTS idx_fitems_status ON factory_items(org_id, status);
CREATE TABLE IF NOT EXISTS factory_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, org_id TEXT NOT NULL, product_id TEXT NOT NULL, item_id TEXT,
  at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_fevents_item ON factory_events(item_id, seq);
CREATE TABLE IF NOT EXISTS factory_usage (
  product_id TEXT NOT NULL, day TEXT NOT NULL, tokens INTEGER NOT NULL DEFAULT 0,
  prs INTEGER NOT NULL DEFAULT 0, deploys INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (product_id, day)
);
CREATE TABLE IF NOT EXISTS factory_sandbox (product_id TEXT PRIMARY KEY, state TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS factory_locks (name TEXT PRIMARY KEY, until INTEGER NOT NULL);
