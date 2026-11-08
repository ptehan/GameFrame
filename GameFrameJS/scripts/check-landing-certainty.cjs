const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [1440,390]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      await page.goto('http://localhost:8000/ev/predictor.html');
      await page.evaluate(() => {
        document.querySelectorAll('dialog[open]').forEach(d => d.close());
        Object.assign(actualFieldMapState, {camera:{lat:43,lng:-77},home:{lat:43.001,lng:-77},
          axis:{lat:43.002,lng:-77},landing:{lat:43.003,lng:-77}, distanceFt:134,signedDirectionDeg:0,
          fieldGeometry:{landing_xy_ft:{x:0,y:134},landing_distance_ft:134,landing_angle_deg:0}});
        setActualMapStage('confirm');
        els.actualFieldMapModal.showModal();
      });
      assert.equal(await page.locator('#actual-map-continue').isDisabled(),true);
      for (const [value,feet,confidence] of [['clear',10,'HIGH'],['area',20,'MEDIUM'],['guess',40,'LOW']]) {
        await page.locator(`input[name="landing-certainty"][value="${value}"]`).check();
        const observation = await page.evaluate(() => currentDistanceObservation());
        assert.equal(observation.uncertainty_ft,feet);
        assert.equal(observation.confidence,confidence);
        assert.equal(observation.landing_certainty,value);
        assert.equal(observation.distance_ft,134);
        assert.equal(await page.locator('#actual-map-continue').isDisabled(),false);
      }
      await page.evaluate(() => setActualMapStage('review'));
      assert.equal(await page.locator('input[value="guess"][name="landing-certainty"]').isChecked(),true);
      const saved = await page.evaluate(() => currentDistanceObservation());
      await page.evaluate(observation => {
        loadPackageIntoState({hit:{distance_observation:{...observation,actual_field_map:null}}});
        setActualMapStage('confirm');
      },saved);
      assert.equal(await page.locator('input[value="guess"][name="landing-certainty"]').isChecked(),true);
      await page.evaluate(() => resetHitSessionForNewVideo());
      assert.equal(await page.evaluate(() => state.distanceCertainty),null);
      console.log(`Landing certainty: choices, persistence and reset passed at ${width}px`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
