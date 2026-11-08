const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.TEST_ORIGIN || 'http://127.0.0.1:8000';
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
      await page.goto(origin + '/library?type=ev');
      const menu = page.locator('[data-modal-title="Library"]');
      await menu.evaluate(a => { a.href += '&type=ev'; });
      if (width < 760) await page.locator('.responsive-menu > summary').click();
      await menu.click();
      const frame = page.frameLocator('#menu-flow-frame');
      const card = frame.locator('.card-row[data-type="ev"]').first();
      await card.locator('summary.library-summary').click();
      const play = card.locator('[data-ev-play]');
      await play.click();
      await frame.locator('#ev-library-video').evaluate(v => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Video did not advance: ' + JSON.stringify({ready:v.readyState,paused:v.paused,error:v.error?.message,time:v.currentTime,status:document.getElementById('ev-library-video-status').textContent}))), 15000);
        v.addEventListener('timeupdate', () => {
          if (v.currentTime > 0.1) { clearTimeout(timeout); resolve(); }
        });
      }));
      await frame.locator('#ev-library-player-close').click();
      assert.equal(await frame.locator('#ev-library-player').evaluate(d => d.open), false);
      assert.equal(await page.locator('#menu-flow-modal').evaluate(d => d.open), true);
      assert.equal(await card.locator('details.library-details').evaluate(d => d.open), true);
      await play.click();
      await page.locator('#menu-flow-close').click();
      assert.equal(await frame.locator('#ev-library-player').evaluate(d => d.open), false);
      assert.equal(await page.locator('#menu-flow-modal').evaluate(d => d.open), true);
      assert.match(page.frames()[1].url(), /\/library\?/);
      await page.close();
    }
    console.log('PASS: saved EV video advances; video and outer Close both retain library, desktop/mobile.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
