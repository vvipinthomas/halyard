// Append-only, hash-chained audit writer shared by API requests and unattended jobs (factory ticks).
// A UNIQUE index on prev_hash makes appends atomic: if another writer extended the chain first,
// our insert violates the constraint and we retry on the new head. Works on SQLite and D1.
// Within one process, appends are also queued per db so concurrent requests don't race for the head
// and exhaust their retries; the constraint retry remains for multiple processes / Workers.
import { sha256 } from './crypto.js';
const queues = new WeakMap();
export function appendAudit(db, entry) {
  const run = (queues.get(db) || Promise.resolve()).then(() => append(db, entry));
  queues.set(db, run.catch(() => {}));
  return run;
}
async function append(db, { org = null, user = null, action, target = null, detail = null, ip = null }) {
  const det = detail == null ? null : JSON.stringify(detail).slice(0, 2000);
  for (let attempt = 0; attempt < 8; attempt++) {
    const last = await db.get('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1');
    const prev = last?.hash || 'GENESIS'; const at = Date.now();
    const entry = { org, user, action, target, detail: det, ip, at };
    const hash = await sha256(prev + JSON.stringify(entry));
    try {
      await db.run('INSERT INTO audit_log (org_id,user_id,action,target,detail,ip,at,prev_hash,hash) VALUES (?,?,?,?,?,?,?,?,?)', [org, user, action, target, det, ip, at, prev, hash]);
      return;
    } catch (e) {
      if (!/UNIQUE|constraint/i.test(String(e.message))) throw e;
      await new Promise((r) => setTimeout(r, 2 + Math.random() * 10 * (attempt + 1)));
    }
  }
  throw new Error('Audit log is busy; please retry');
}
