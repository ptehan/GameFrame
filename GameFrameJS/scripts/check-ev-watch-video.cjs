const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.goto('http://localhost:8000/ev/predictor.html');
      await page.locator('#video-file').setInputFiles(process.argv[2]);
      await page.waitForFunction(() => document.querySelector('#video').readyState >= 2);
      await page.evaluate(() => {
        document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
        state.contactTime = 1;
        state.ballPathAudioStarted = true;
        state.observations = [{ image_x: 100, image_y: 150, relative_time_s: 0, source: 'HUMAN', role: 'CONTACT_POINT' }];
        els.video.currentTime = 1;
      });
      await page.waitForFunction(() => !document.querySelector('#video').seeking);
      for (const step of ['geometry', 'landmarks', 'ballPath', 'groundChoice', 'ground', 'player']) {
        console.log(`Checking ${width}px ${step}`);
        await page.evaluate(step => { renderWorkflowStep(step); if (!els.setupModal.open) els.setupModal.showModal(); }, step);
        await page.waitForFunction(() => !document.querySelector('#video').seeking);
        const before = await page.evaluate(() => ({ marks: JSON.stringify(state.observations), time: els.video.currentTime, step: activeWorkflowStep }));
        await page.locator('#setup-modal .setup-heading .watch-source-button').click();
        await page.waitForFunction(() => document.querySelector('#watch-source-video').currentTime > 1.1);
        await page.keyboard.press('ArrowRight');
        assert.deepEqual(await page.evaluate(() => ({ marks: JSON.stringify(state.observations), time: els.video.currentTime, step: activeWorkflowStep })), before);
        const bounds = await page.locator('#watch-source-modal').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
        await page.locator('#watch-source-close').click();
        assert.equal(await page.locator('#setup-modal').evaluate(dialog => dialog.open), true);
        assert.equal(await page.locator('#watch-source-video').evaluate(video => video.paused), true);
      }
      await page.evaluate(() => document.querySelector('#actual-field-map-modal').showModal());
      await page.locator('#actual-field-map-modal .watch-source-button').click();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#actual-field-map-modal').evaluate(dialog => dialog.open), true);
      console.log(`Watch video: all six workflow steps and map return passed at ${width}px`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
