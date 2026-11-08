const assert=require('node:assert/strict');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const width of [1440,390]) {
   const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
   await page.goto('http://localhost:8000/matchup/select?embedded=1&sid=x',{waitUntil:'networkidle'});
   await page.locator('.gf-step-help summary').click();
   assert.match(await page.locator('.gf-step-help-content').innerText(),/raw pitch/);
   await page.locator('#matchup-next').click();
   assert.equal(await page.locator('.gf-step-help').getAttribute('open'),null);
   await page.locator('.gf-step-help summary').focus();
   await page.keyboard.press('Enter');
   assert.match(await page.locator('.gf-step-help-content').innerText(),/known contact/);
   await page.setContent('<main><h2 id="actual-field-map-title">Tag Where Ball Landed</h2><section data-step="start"><h3 id="swing_step_title">Set Swing Start Frame</h3></section><h2 id="setup-title">Mark the ball 20 frames after contact</h2></main>');
   await page.evaluate(()=>delete window.GameFrameHelp);
   await page.addScriptTag({path:path.join(__dirname,'../static/js/workflow-help.js')});
   assert.equal(await page.locator('.gf-step-help').count(),3);
   await page.locator('.gf-step-help summary').first().click();
   assert.match(await page.locator('.gf-step-help-content').first().innerText(),/first ground contact/);
   await page.locator('.gf-step-help summary').nth(1).click();
   assert.match(await page.locator('.gf-step-help-content').nth(1).innerText(),/not automatically worse/);
   await page.locator('.gf-step-help summary').nth(2).click();
   assert.match(await page.locator('.gf-step-help-content').nth(2).innerText(),/20 at 60 fps/);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.close();
  }
  console.log('PASS: desktop/mobile Help, keyboard activation, step-specific copy, automatic close on navigation, no horizontal overflow.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
