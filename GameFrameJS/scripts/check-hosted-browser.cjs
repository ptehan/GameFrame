const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve('release-artifacts/browser-tools/node_modules/playwright'));
process.env.NODE_ENV = 'test'; delete process.env.RESEND_API_KEY; delete process.env.AUTH_FROM_EMAIL; delete process.env.SITE_ORIGIN;
  process.env.AUTH_CODE_SECRET = 'browser-smoke-only-secret';
process.env.AUTH_ALLOW_DEV_CODE = 'true';
process.env.GAMEFRAME_PREWARM_EV = '0';
const { createHostedApplication } = require('../hosted/server');
(async () => {
  const server = require('node:http').createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const hosted = createHostedApplication({ directory: fs.mkdtempSync(path.join(os.tmpdir(), 'gf-hosted-browser-')), origin });
  server.on('request', hosted.app);
  hosted.db.prepare('INSERT INTO hosted_invites VALUES(?)').run('browser@test.invalid');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const screenshots = path.resolve('release-artifacts/browser'); fs.mkdirSync(screenshots, { recursive: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/auth/login');
      await page.getByLabel('Email').fill('browser@test.invalid');
      const requested = page.waitForResponse(r => r.url().endsWith('/api/v1/auth/request-code'));
      await page.getByRole('button', { name: 'Send sign-in code' }).click();
      const code = (await (await requested).json()).development_code;
      await page.getByLabel('Code', { exact: true }).fill(code);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      await page.waitForURL(origin + '/');
      const id = hosted.db.prepare("SELECT id FROM auth_accounts WHERE email='browser@test.invalid'").get().id;
      const tenant = new (require('better-sqlite3'))(path.join(hosted.directory, 'workspaces', id, 'app.db'));
      tenant.exec("INSERT OR IGNORE INTO teams(id,name) VALUES(777,'Browser fixture team');INSERT OR IGNORE INTO pitchers(id,team_id,name) VALUES(777,777,'Browser fixture pitcher')");
      tenant.prepare('INSERT OR IGNORE INTO pitch_clips(id,team_id,pitcher_id,description,clip_blob) VALUES(777,777,777,?,?)')
        .run('<img src=x onerror="window.libraryAttack=1">', Buffer.from('test-video'));
      tenant.close();
      await page.goto(origin + '/library?type=pitch&sid=' + encodeURIComponent('\"><svg onload="window.libraryAttack=1">'));
      try { await page.waitForFunction(() => document.querySelector('#library_grid')?.textContent.includes('<img src=x')); }
      catch (error) {
        fs.writeFileSync(path.join(screenshots, 'library-debug.json'), JSON.stringify({ errors, url: page.url(), text: await page.locator('body').innerText() }, null, 2));
        await page.screenshot({ path: path.join(screenshots, 'library-debug.png'), fullPage: true }); throw error;
      }
      assert.equal(await page.evaluate(() => window.libraryAttack), undefined, 'library text and session IDs cannot inject markup');
      await page.goto(origin + '/account');
      await page.locator('#summary').filter({ hasText: '3/3 credits remaining' }).waitFor();
      await page.screenshot({ path: path.join(screenshots, `account-${width}.png`), fullPage: true });
      assert.equal(await page.locator('body').evaluate(el => el.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#checkout').isVisible(), false);
      await page.goto(origin + '/ev/predictor.html');
      await page.locator('#video-file').waitFor({ state: 'attached' });
      assert.equal(await page.evaluate(() => window.GAMEFRAME_HOSTED), true);
      assert.deepEqual(errors, []);
      await page.goto(origin + '/account');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL(origin + '/auth/login');
      await page.close();
    }
    console.log('Desktop/mobile sign-in, usage, closed sales, EV startup and logout passed.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); hosted.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
