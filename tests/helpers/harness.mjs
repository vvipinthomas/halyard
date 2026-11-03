// In-process API harness: real Hono app + real SQLite (in memory), cookie jar per client.
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createApp } from '../../src/app.js';
import { sqliteAdapter } from '../../src/lib/db.js';
import { migrateSqlite } from '../../src/lib/migrate.js';

export function makeServer(envOverrides = {}, fetchImpl) {
  const sqlite = new Database(':memory:');
  migrateSqlite(sqlite, new URL('../../migrations/', import.meta.url));
  const db = sqliteAdapter(sqlite);
  const env = { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'), ...envOverrides };
  const app = createApp({ getDb: () => db, getEnv: () => env, fetchImpl });
  return { app, db, sqlite, env };
}

export function client(app, { ip = '10.0.0.1' } = {}) {
  let cookie = '';
  const req = async (method, path, body, headers = {}) => {
    const h = { 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { 'x-halyard': '1' } : {}), ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await app.request(path, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].includes('=;') || /Max-Age=0/i.test(sc) ? '' : sc.split(';')[0];
    const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { get: (p, h) => req('GET', p, undefined, h), post: (p, b, h) => req('POST', p, b, h), put: (p, b, h) => req('PUT', p, b, h), patch: (p, b, h) => req('PATCH', p, b, h), del: (p, h) => req('DELETE', p, undefined, h), get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

export const ADMIN = { email: 'admin@example.com', password: 'correct-horse-42', name: 'Admin', org: 'Acme' };
export async function bootstrapped(env) {
  const s = makeServer(env); const admin = client(s.app);
  const r = await admin.post('/api/auth/bootstrap', ADMIN); if (r.status !== 201) throw new Error(JSON.stringify(r.json));
  return { ...s, admin };
}
