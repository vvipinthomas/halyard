// First-run helper: creates .env from .env.example with a fresh ENCRYPTION_KEY.
// Idempotent and cross-platform (no openssl needed). Runs automatically before `npm start` / `npm run dev`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`[halyard] Node.js 22 or newer is required (you have ${process.version}). Install the LTS from https://nodejs.org`);
  process.exit(1);
}

// A key supplied by the environment (CI, Docker, a secrets manager) always wins; leave files alone.
if (process.env.ENCRYPTION_KEY) process.exit(0);

const root = new URL('../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', root));
const examplePath = fileURLToPath(new URL('.env.example', root));
const key = randomBytes(32).toString('base64');

if (!existsSync(envPath)) {
  const template = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : 'ENCRYPTION_KEY=\n';
  writeFileSync(envPath, template.replace(/^ENCRYPTION_KEY=.*$/m, `ENCRYPTION_KEY=${key}`), { mode: 0o600 });
  console.log('[halyard] Created .env with a new ENCRYPTION_KEY. Back it up: data encrypted with it cannot be read with another key.');
} else {
  const text = readFileSync(envPath, 'utf8');
  if (/^ENCRYPTION_KEY=\s*$/m.test(text)) {
    writeFileSync(envPath, text.replace(/^ENCRYPTION_KEY=\s*$/m, `ENCRYPTION_KEY=${key}`));
    console.log('[halyard] Added a new ENCRYPTION_KEY to your existing .env.');
  } else if (!/^ENCRYPTION_KEY=/m.test(text)) {
    writeFileSync(envPath, `${text.replace(/\n?$/, '\n')}ENCRYPTION_KEY=${key}\n`);
    console.log('[halyard] Added a new ENCRYPTION_KEY to your existing .env.');
  }
}
