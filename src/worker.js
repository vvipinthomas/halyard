// Cloudflare Workers entry: API via Hono + D1, static PWA via Workers Static Assets.
import { createApp } from './app.js';
import { d1Adapter } from './lib/db.js';

const app = createApp({ getDb: (c) => d1Adapter(c.env.DB), getEnv: (c) => c.env });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return app.fetch(req, env, ctx);
    return env.ASSETS.fetch(req);
  },
  async scheduled(_evt, env, ctx) { const db = d1Adapter(env.DB); await app.housekeep(db); ctx.waitUntil(app.factoryTick(db, env)); },
};
