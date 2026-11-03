// Node / Docker entry: same Hono app, SQLite storage, static files from ./public.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { sqliteAdapter } from './lib/db.js';
import { migrateSqlite } from './lib/migrate.js';
import { unb64 } from './lib/crypto.js';

// Local runs read ./.env (created by `npm run setup`). Variables already in the environment take precedence.
const dotenv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(dotenv)) process.loadEnvFile(dotenv);

const env = { ...process.env };
const fail = (msg) => { console.error(`[halyard] ${msg}`); process.exit(1); };

// Fail fast on a malformed key rather than at the first encrypt/decrypt.
if (env.ENCRYPTION_KEY) {
  let len = 0; try { len = unb64(env.ENCRYPTION_KEY.trim()).length; } catch {}
  if (len !== 32) fail('ENCRYPTION_KEY must be 32 random bytes, base64-encoded (see README).');
  env.ENCRYPTION_KEY = env.ENCRYPTION_KEY.trim();
} else if (env.NODE_ENV === 'production') fail('ENCRYPTION_KEY is required when NODE_ENV=production (see README).');
else console.warn('[halyard] ENCRYPTION_KEY is not set — provider keys cannot be stored. Run `npm run setup` to generate one.');

const dbPath = env.DATABASE_PATH || './data/halyard.db';
if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');
sqlite.pragma('busy_timeout = 5000');
sqlite.pragma('foreign_keys = ON');
migrateSqlite(sqlite, new URL('../migrations/', import.meta.url));
const db = sqliteAdapter(sqlite);

const api = createApp({ getDb: () => db, getEnv: () => env });
const root = new Hono();
root.route('/', api);
// serveStatic resolves against the working directory, so point it at ./public wherever we're started from.
const publicDir = relative(process.cwd(), fileURLToPath(new URL('../public/', import.meta.url))) || '.';
root.use('/*', serveStatic({ root: publicDir }));
root.get('*', serveStatic({ path: `${publicDir}/index.html` }));

// The app reads the client IP from cf-connecting-ip / x-forwarded-for. Without a proxy those are
// client-controlled, so replace them with the socket address. With TRUST_PROXY=true (exactly one
// reverse proxy in front), use the address that proxy appended and honour its X-Forwarded-Proto.
const trustProxy = /^(1|true|yes)$/i.test(env.TRUST_PROXY || '');
function fetchWithClientIp(req, nodeEnv) {
  const h = new Headers(req.headers); let url = req.url;
  const sock = nodeEnv?.incoming?.socket?.remoteAddress || 'local';
  h.delete('cf-connecting-ip');
  if (trustProxy) {
    h.set('x-forwarded-for', (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean).pop() || sock);
    if (h.get('x-forwarded-proto') === 'https') url = url.replace(/^http:/, 'https:');
  } else h.set('x-forwarded-for', sock);
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  return root.fetch(new Request(url, { method: req.method, headers: h, body: hasBody ? req.body : undefined, duplex: 'half', signal: req.signal }), nodeEnv);
}

const housekeep = () => api.housekeep(db).catch((e) => console.error('[housekeep]', e.message));
const housekeeper = setInterval(housekeep, 10 * 60 * 1000); housekeeper.unref();
const tickEvery = Number(env.FACTORY_TICK_SECONDS ?? 300);
let ticking = null;
const ticker = tickEvery > 0 ? setInterval(() => {
  ticking = api.factoryTick(db, env).catch((e) => console.error('[factory]', e.message)).finally(() => { ticking = null; });
}, tickEvery * 1000) : null;
ticker?.unref();

const port = Number(env.PORT) || 8787;
const server = serve({ fetch: fetchWithClientIp, port, hostname: env.HOST || '0.0.0.0' }, () => console.log(`[halyard] listening on http://localhost:${port}`));
server.on('error', (e) => fail(e.code === 'EADDRINUSE' ? `port ${port} is already in use (set PORT to change it)` : e.message));

// Graceful shutdown: stop accepting requests, let an in-flight factory tick finish, then close SQLite
// so the WAL is checkpointed. `docker stop` sends SIGTERM and waits 10s before SIGKILL.
let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`[halyard] ${sig} received, shutting down`);
  clearInterval(housekeeper); if (ticker) clearInterval(ticker);
  setTimeout(() => { console.error('[halyard] shutdown timed out'); process.exit(1); }, 8000).unref();
  await new Promise((r) => { server.close(r); server.closeIdleConnections?.(); });
  if (ticking) await ticking;
  sqlite.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => console.error('[halyard] unhandled rejection', e));

export { root, db };
