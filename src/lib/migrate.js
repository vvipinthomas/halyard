// Applies migrations/*.sql in order for SQLite (Docker/tests). D1 uses `wrangler d1 migrations apply`.
import { readdirSync, readFileSync } from 'node:fs';
export function migrateSqlite(sqlite, dirUrl) {
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(sqlite.prepare('SELECT name FROM _migrations').all().map((r) => r.name));
  for (const f of readdirSync(dirUrl).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    sqlite.transaction(() => { sqlite.exec(readFileSync(new URL(f, dirUrl), 'utf8')); sqlite.prepare('INSERT INTO _migrations VALUES (?, ?)').run(f, Date.now()); })();
  }
}
