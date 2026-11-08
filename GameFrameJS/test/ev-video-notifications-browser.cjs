const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));let ready=false;
  await page.route('**/api/gameframe/ev-video-status?id=991',route=>route.fulfill({json:{id:991,status:ready?'ready':'rendering'}}));
  const base=process.env.GAMEFRAME_TEST_URL||'http://127.0.0.1:8000';
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>GameFrameEvVideoNotifications.track(991));
  await page.locator('#ev-video-background-notice').filter({hasText:'being prepared'}).waitFor();
  assert.equal(await page.locator('#ev-video-background-notice a').count(),0);
  await page.waitForFunction(()=>!document.getElementById('ev-video-background-notice').matches(':popover-open'),null,{timeout:7000});
  await page.goto(base+'/library?type=swing',{waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#ev-video-background-notice:popover-open').count(),0,'Do not repeat the saved popup on each page');
  ready=true;
  const link=page.locator('#ev-video-background-notice a');await link.waitFor();
  assert.equal(await link.textContent(),'View video');assert.equal(await link.getAttribute('href'),'/play/ev?id=991');
  assert.equal(await link.getAttribute('target'),'_blank');
  await page.waitForFunction(()=>!document.getElementById('ev-video-background-notice').matches(':popover-open'),null,{timeout:15000});
  await page.reload({waitUntil:'domcontentloaded'});
  assert.equal(await page.locator('#ev-video-background-notice:popover-open').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS: saved popup disappears, polling continues across navigation, ready popup links to video and disappears.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
