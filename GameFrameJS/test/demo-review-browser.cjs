const assert=require('node:assert/strict'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:1000}});
   await page.goto(pathToFileURL(path.resolve(__dirname,'../demo-output/index.html')).href);
   await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   assert.equal(await page.locator('#warning').isVisible(),true);
   await page.locator('#ev-tab').focus();await page.keyboard.press('ArrowRight');
   assert.equal(await page.locator('#pitch-tab').getAttribute('aria-selected'),'true');
   assert.equal(await page.locator('#warning').isVisible(),false);
   await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   assert.ok(await page.locator('video').evaluate(v=>v.duration)>120);
   await page.locator('#matchup-tab').click();await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   assert.equal(await page.locator('video').getAttribute('src'),'Matchup-Walkthrough.mp4');
   assert.equal(await page.locator('a[download]').count(),0);
   await page.locator('#ev-tab').click();await page.waitForFunction(()=>document.querySelector('video').readyState>=1);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.resolve(__dirname,`../demo-output/review-page-${width}.png`),fullPage:true});
   await page.close();
  }
  console.log('PASS: review page loads all three local videos; tabs, keyboard, warning, desktop/mobile layout.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
