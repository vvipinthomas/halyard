// Regenerates the images in docs/images from the real UI (in-memory DB, dry-run model: no keys, no network).
// Usage: npx playwright install chromium   (once)
//        npm run screenshots
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, devices } from '@playwright/test';

const PORT = Number(process.env.SHOT_PORT) || 8795;
const BASE = `http://localhost:${PORT}`;
const OUT = fileURLToPath(new URL('../docs/images/', import.meta.url));
const ADMIN = { name: 'Alex Rivera', email: 'admin@example.com', password: 'correct-horse-42' };
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['src/node.js'], {
  cwd: fileURLToPath(new URL('../', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: ':memory:', ENCRYPTION_KEY: Buffer.from('screenshot-key-not-for-production').subarray(0, 32).toString('base64'), PBKDF2_ITERATIONS: '20000', FACTORY_TICK_SECONDS: '0' },
  stdio: 'inherit',
});
const stop = () => { try { server.kill(); } catch {} };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('server did not start');
}

const nav = (page, name) => page.getByRole('navigation').getByRole('link', { name, exact: true }).click();
const settle = (page, ms = 900) => page.waitForTimeout(ms);
const shot = async (page, name) => {
  await settle(page);
  // Transient pop-ups clutter the images; hide them only for the capture (the script waits on some of them).
  await page.evaluate(() => document.querySelector('.toasts')?.style.setProperty('visibility', 'hidden'));
  await page.screenshot({ path: `${OUT}${name}.png` });
  await page.evaluate(() => document.querySelector('.toasts')?.style.removeProperty('visibility'));
  console.log(`  ✓ ${name}.png`);
};

async function signIn(page) {
  await page.goto(BASE);
  const form = page.locator('form[data-form]'); await form.waitFor();
  if ((await form.getAttribute('data-form')) === 'bootstrap') {
    await page.fill('input[name=name]', ADMIN.name); await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password);
    await page.getByRole('button', { name: 'Create admin & sign in', exact: true }).click();
  } else {
    await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await page.getByRole('heading', { name: 'Your crew', exact: true }).waitFor();
}

async function run(page, target, input) {
  await nav(page, 'Run');
  await page.locator('[data-input=run-target]').selectOption(target);
  await page.locator('[data-input=pref-provider]').selectOption('dryrun');
  await page.fill('#run-input', input);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'light' });
  const page = await ctx.newPage();

  // First-run screen, before any account exists.
  await page.goto(BASE); await page.locator('form[data-form=bootstrap]').waitFor();
  await shot(page, '01-first-run');

  await signIn(page);
  await page.getByRole('button', { name: 'Add starter crew' }).first().click();
  await page.locator('article.agent').nth(9).waitFor();
  await shot(page, '02-crew');

  await nav(page, 'Library');
  await page.getByRole('tab', { name: /Agents/ }).waitFor();
  await shot(page, '03-library');
  await page.getByRole('tab', { name: /MCP servers/ }).click();
  await shot(page, '04-library-mcp');

  await nav(page, 'Library');
  await page.getByRole('tab', { name: /Agents/ }).click();
  await page.getByRole('searchbox').fill('Speechwriter');
  await page.getByRole('button', { name: 'Copy & adapt' }).first().click();
  await page.locator('.drawer').getByText('Adapted from library item').waitFor();
  await shot(page, '05-agent-editor');
  await page.keyboard.press('Escape');

  await nav(page, 'Flows');
  await page.getByRole('button', { name: 'New flow' }).click();
  const d = page.locator('.drawer');
  await d.locator('input[name=name]').fill('Draft, review, approve');
  for (const step of ['agent', 'loop', 'approval']) await d.getByRole('button', { name: step, exact: true }).click();
  await d.getByRole('button', { name: /Validate/ }).click();
  await d.getByText('Valid', { exact: true }).waitFor();
  await shot(page, '06-flow-builder');
  await d.getByRole('button', { name: 'Save' }).click();

  await run(page, 'flow:flow.x.release-readiness-review', 'Are we ready to ship 2.3?');
  await page.locator('.crew-stage .crew[data-state="happy"]').first().waitFor({ timeout: 20_000 });
  await shot(page, '07-run');

  await run(page, 'flow:flow.write.maker-checker', 'Write a 200-word post about our new release');
  await page.getByText('loop exit: condition met').waitFor({ timeout: 20_000 });
  await page.getByRole('button', { name: /Accept/ }).click();
  await nav(page, 'Value');
  await page.getByRole('heading', { name: 'Value & adoption' }).waitFor();
  await shot(page, '08-value');

  await nav(page, 'Factory');
  await page.getByRole('button', { name: 'Operate an existing product' }).click();
  await page.locator('form[data-form=fac-product] input[name=name]').fill('Acme Shop');
  await page.locator('form[data-form=fac-product]').getByRole('button', { name: 'Save' }).click();
  for (const sc of ['null-price', 'auth-timeout', 'bad-fix']) {
    await page.locator('[data-input=fac-scenario]').selectOption(sc);
    await page.getByRole('button', { name: 'Inject incident' }).click();
    await page.getByText(/Crew ran:/).last().waitFor();
  }
  await shot(page, '09-factory');
  await page.locator('[data-input=fac-scenario]').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await shot(page, '09b-factory-board');

  await nav(page, 'Settings');
  await page.getByRole('tab', { name: 'Design system' }).click();
  await shot(page, '10-design-system');

  // Dark theme hero of the crew.
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await nav(page, 'Crew');
  await page.locator('article.agent').first().waitFor();
  await shot(page, '11-crew-dark');
  await page.evaluate(() => { delete document.documentElement.dataset.theme; });

  // Command palette.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog', { name: 'Command palette' }).waitFor();
  await page.keyboard.type('flow');
  await shot(page, '12-command-palette');
  await page.keyboard.press('Escape');

  // Mobile view of the crew, sharing the same session.
  const state = await ctx.storageState();
  const mctx = await browser.newContext({ ...devices['Pixel 7'], storageState: state, colorScheme: 'light' });
  const m = await mctx.newPage();
  await m.goto(`${BASE}/#/crew`); await m.locator('article.agent').first().waitFor();
  await shot(m, '13-mobile');

  console.log(`Screenshots written to ${OUT}`);
} catch (e) {
  console.error(e); process.exitCode = 1;
} finally { await browser?.close(); stop(); }
