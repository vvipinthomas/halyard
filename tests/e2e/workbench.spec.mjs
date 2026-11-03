// End-to-end journeys through the real UI and API (SQLite in memory, dry-run provider — no model calls).
import { test, expect } from '@playwright/test';
import { totp, hotp, counterAt } from '../../src/lib/totp.js';

const ADMIN = { email: 'admin@example.com', password: 'correct-horse-42' };
test.describe.configure({ mode: 'serial' });

async function signIn(page) {
  await page.goto('/');
  const form = page.locator('form[data-form]');
  await form.waitFor();
  if ((await form.getAttribute('data-form')) === 'bootstrap') {
    await page.fill('input[name=name]', 'E2E Admin'); await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password);
    await page.getByRole('button', { name: 'Create admin & sign in', exact: true }).click();
  } else {
    await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: 'Your crew', exact: true })).toBeVisible();
}

test('first-run setup, starter crew with characters', async ({ page }) => {
  await signIn(page);
  if (!(await page.locator('article.agent').count())) await page.getByRole('button', { name: 'Add starter crew' }).first().click();
  await expect(page.locator('article.agent').nth(9)).toBeVisible();
  await expect(page.locator('article.agent svg[role=img]').first()).toBeVisible();
  await expect(page.getByText(/the (otter|owl|lion|hedgehog|penguin|cat|dog|fox|beaver)/).first()).toBeVisible();
});

test('library: browse, search, filter, verified MCP banner, copy & adapt an agent', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Agents/ })).toContainText('210');
  await page.getByRole('searchbox').fill('threat');
  await expect(page.locator('article.agent').first()).toContainText('Threat Modeler');
  await page.getByRole('tab', { name: /MCP servers/ }).click();
  await expect(page.getByText('confirmed on npm or PyPI')).toBeVisible();
  await page.getByRole('tab', { name: /Agents/ }).click();
  await page.getByRole('searchbox').fill('Speechwriter');
  await page.getByRole('button', { name: 'Copy & adapt' }).first().click();
  const drawer = page.locator('.drawer');
  await expect(drawer.getByText('Adapted from library item')).toBeVisible();
  await drawer.locator('input[name=name]').fill('Keynote Writer');
  await drawer.locator('select[name=species]').selectOption('axolotl');
  await drawer.locator('input[name=minutes]').fill('120');
  await drawer.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Crew', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keynote Writer' }).first()).toBeVisible();
  await expect(page.getByText('the axolotl').first()).toBeVisible();
});

test('XSS: user-supplied names are rendered as text', async ({ page }) => {
  await signIn(page);
  let fired = false; page.on('dialog', async (d) => { fired = true; await d.dismiss(); });
  await page.getByRole('navigation').getByRole('link', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New skill' }).click();
  await page.locator('.drawer input[name=name]').fill('<img src=x onerror=alert(1)>');
  await page.locator('.drawer').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();
  expect(fired).toBe(false);
});

test('flow builder: add steps, validate, save', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Flows', exact: true }).click();
  await page.getByRole('button', { name: 'New flow' }).click();
  const d = page.locator('.drawer');
  await d.locator('input[name=name]').fill('Review then approve');
  await d.getByRole('button', { name: 'agent', exact: true }).click();
  await d.getByRole('button', { name: 'loop', exact: true }).click();
  await d.getByRole('button', { name: 'approval', exact: true }).click();
  await d.getByRole('button', { name: /Validate/ }).click();
  await expect(d.getByText('Valid', { exact: true })).toBeVisible();
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Review then approve' }).first()).toBeVisible();
});

test('run a library maker–checker loop, accept it, and see KPIs move', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Run', exact: true }).click();
  await page.locator('[data-input=run-target]').selectOption('flow:flow.write.maker-checker');
  await page.locator('[data-input=pref-provider]').selectOption('dryrun');
  await page.fill('#run-input', 'Write a 200-word post about our new release');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.getByText('loop exit: condition met')).toBeVisible();
  await expect(page.getByText('DRY RUN — no model was called').first()).toBeVisible();
  await expect(page.getByText('dry run — excluded from value')).toBeVisible();
  await page.getByRole('button', { name: /Accept/ }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Value', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Value & adoption' })).toBeVisible();
  await expect(page.getByText(/dry run\(s\) in this window are excluded/)).toBeVisible();
});

test('approval gate: rejecting stops the flow', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Run', exact: true }).click();
  await page.locator('[data-input=run-target]').selectOption('flow:flow.eng.pipeline');
  await page.fill('#run-input', 'Refactor the payment module');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await page.locator('.modal').getByRole('button', { name: 'Reject' }).click();
  await expect(page.locator('.chip', { hasText: 'rejected' }).first()).toBeVisible();
});

test('value model and team admin', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Value model' }).click();
  await page.fill('input[name=hourlyRate]', '90');
  await page.fill('textarea[name=prices]', 'anthropic/example-model 3 15');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Value model saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Team' }).click();
  await page.fill('form[data-form=user-new] input[name=name]', 'Riya');
  await page.fill('form[data-form=user-new] input[name=email]', `riya${Date.now()}@example.com`);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(/Temporary password/)).toBeVisible();
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await page.getByRole('button', { name: 'Verify hash chain' }).click();
  await expect(page.getByText(/Chain intact/)).toBeVisible();
});

test('command palette and keyboard navigation', async ({ page, isMobile }) => {
  test.skip(isMobile, 'keyboard shortcuts are a desktop affordance');
  await signIn(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.type('value');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Value & adoption' })).toBeVisible();
  await page.keyboard.press('g'); await page.keyboard.press('l');
  await expect(page).toHaveURL(/#\/library/);
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
});

test('animated crew reacts to the run and the style guide shows every state', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Run', exact: true }).click();
  await page.locator('[data-input=run-target]').selectOption('flow:flow.x.release-readiness-review');
  await page.locator('[data-input=pref-provider]').selectOption('dryrun');
  await page.fill('#run-input', 'Ready to ship 2.3?');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(page.locator('.crew-stage .member')).toHaveCount(4);
  await expect(page.locator('.crew-stage .crew[data-state="happy"]').first()).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Design system' }).click();
  for (const st of ['idle', 'thinking', 'working', 'tool', 'talking', 'happy', 'sad', 'sleeping', 'waving']) await expect(page.locator(`.crew[data-state="${st}"]`).first()).toBeAttached();
});

test('MFA: enrol with an authenticator, sign in with a code, turn off with a recovery code', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /Set up two-step sign-in/ }).click();
  const secret = (await page.locator('[data-secret]').innerText()).replace(/\s+/g, '');
  await page.fill('#mfa-code', await totp(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('heading', { name: 'Save your recovery codes' })).toBeVisible();
  const recovery = (await page.locator('.recovery-grid span').first().innerText()).trim();
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
  await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Two-step check' })).toBeVisible();
  await page.fill('input[name=code]', '000000'); await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code didn’t work')).toBeVisible();
  await page.fill('input[name=code]', await hotp(secret, counterAt() + 1)); await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: 'Your crew', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByText('Turn off two-step sign-in').click();
  await page.fill('form[data-form=mfa-disable] input[name=password]', ADMIN.password);
  await page.fill('form[data-form=mfa-disable] input[name=code]', recovery);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('Two-step sign-in is off.')).toBeVisible();
});

test('software factory: sandbox incidents are fixed, gated, rolled back, and the andon cord stops the line', async ({ page, isMobile }) => {
  test.skip(isMobile, 'covered on desktop; board layout is responsive');
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Factory', exact: true }).click();
  await page.getByRole('button', { name: 'Operate an existing product' }).click();
  await page.locator('form[data-form=fac-product] input[name=name]').fill('E2E Shop');
  await page.locator('form[data-form=fac-product]').getByRole('button', { name: 'Save' }).click();
  for (const sc of ['null-price', 'auth-timeout', 'bad-fix']) {
    await page.locator('[data-input=fac-scenario]').selectOption(sc);
    await page.getByRole('button', { name: 'Inject incident' }).click();
    await expect(page.getByText(/Crew ran:/).last()).toBeVisible();
  }
  await expect(page.locator('.lane[aria-label="Done"] .fcard')).toHaveCount(1);
  await expect(page.locator('.lane[aria-label="Rolled back / closed"] .fcard')).toHaveCount(1);
  const gate = page.locator('.lane[aria-label="Needs you"] .fcard').first();
  await expect(gate).toContainText('approve release');
  await gate.click();
  await expect(page.getByText('Release needs your approval.')).toBeVisible();
  await page.getByRole('button', { name: 'Approve & merge' }).click();
  await expect(page.getByText(/Approved. The crew is on it/)).toBeVisible();
  await page.getByRole('button', { name: 'Run crew now' }).click();
  await expect(page.locator('.lane[aria-label="Done"] .fcard')).toHaveCount(2);
  page.once('dialog', (d) => d.accept('freeze for launch'));
  await page.getByRole('button', { name: 'Stop line' }).click();
  await expect(page.getByText('stopped').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run crew now' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restart line' }).click();
});

test('software factory: build a new product from a brief, approve plan and launch, then the crew operates it', async ({ page, isMobile }) => {
  test.skip(isMobile, 'covered on desktop');
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Factory', exact: true }).click();
  await page.getByRole('button', { name: 'Build new', exact: true }).click();
  const form = page.locator('form[data-form=fac-product]');
  await form.locator('input[name=name]').fill('Team Items');
  await form.locator('textarea[name=brief]').fill('Small teams need one shared list of items they can add to and see instantly.');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Building Team Items' })).toBeVisible();
  const b = (n) => page.getByRole('button', { name: n, exact: true });
  await expect(b('Review plan')).toBeVisible({ timeout: 10_000 }).catch(async () => { await b('Run crew now').click(); await expect(b('Review plan')).toBeVisible(); });
  await b('Review plan').click();
  await expect(page.getByRole('heading', { name: /PRD/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Architecture' })).toBeVisible();
  await b('Approve plan').click();
  await b('Run crew now').click();
  await expect(b('Review launch')).toBeVisible();
  await b('Review launch').click();
  await expect(page.getByText('Ready to launch.')).toBeVisible();
  await b('Approve launch').click();
  await b('Run crew now').click();
  await expect(page.getByText(/launched\. The crew now operates it/).first()).toBeVisible();
  await expect(page.locator('[data-input=fac-scenario] option')).toHaveText(['feature-request', 'null-title']);
});

test('sign out returns to the login screen', async ({ page }) => {
  await signIn(page);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
