const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'gf-matchup-wizard-'));
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      let submissions=0;
      await page.route('**/matchup/create*',async route=>{
        submissions++;
        await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Test rejection; no record created.'})});
      });
      await page.goto('http://localhost:8000/matchup/select?embedded=1&sid=x',{waitUntil:'networkidle'});
      assert.equal(await page.locator('#matchup-step-title').innerText(),'Choose a pitch');
      assert.ok(await page.locator('#pitch_clip').inputValue(),'Needs an existing pitch for this non-mutating UI test');
      assert.equal(await page.locator('#swing_clip').isVisible(),false);
      await page.locator('#matchup-next').click();
      assert.equal(await page.locator('#matchup-step-title').innerText(),'Choose a swing');
      assert.ok(await page.locator('#swing_clip').inputValue(),'Needs an existing swing for this non-mutating UI test');
      await page.locator('#matchup-next').click();
      await page.locator('#desc').fill('CODEX TEST - browser validation only');
      assert.equal(await page.locator('#matchup-review-clips .matchup-preview-card').count(),2);
      await page.screenshot({path:path.join(output,`review-${width}.png`)});
      await page.locator('#matchup-back').click();
      await page.locator('#matchup-next').click();
      assert.equal(await page.locator('#desc').inputValue(),'CODEX TEST - browser validation only');
      await page.locator('#matchup-create').click();
      await page.waitForFunction(()=>document.getElementById('status').textContent.includes('Test rejection')).catch(async error=>{
        console.error({submissions,errors,status:await page.locator('#status').innerText()});
        throw error;
      });
      assert.equal(submissions,1);
      assert.equal(await page.locator('#matchup-create').isEnabled(),true);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('PASS desktop/mobile wizard navigation, review, retained description, failed-submit recovery. No data created. '+output);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
