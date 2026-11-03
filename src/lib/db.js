// Minimal async DB interface shared by Cloudflare D1 and better-sqlite3.
// all(sql, params) → rows; get(sql, params) → row|null; run(sql, params) → { changes }; batchExec(sqlText)

export function d1Adapter(d1) {
  return {
    async all(sql, p = []) { return (await d1.prepare(sql).bind(...p).all()).results ?? []; },
    async get(sql, p = []) { return (await d1.prepare(sql).bind(...p).first()) ?? null; },
    async run(sql, p = []) { const r = await d1.prepare(sql).bind(...p).run(); return { changes: r.meta?.changes ?? 0 }; },
    async batchExec(sql) { await d1.exec(sql.replace(/--.*$/gm, '').replace(/\n/g, ' ')); },
  };
}

export function sqliteAdapter(db) {
  return {
    async all(sql, p = []) { return db.prepare(sql).all(...p); },
    async get(sql, p = []) { return db.prepare(sql).get(...p) ?? null; },
    async run(sql, p = []) { const r = db.prepare(sql).run(...p); return { changes: r.changes }; },
    async batchExec(sql) { db.exec(sql); },
  };
}
