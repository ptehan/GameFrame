const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-single-dialog-')),'test.db');
 const {startServer,closeDatabase}=require('../server'),server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/?sid=x`,{waitUntil:'networkidle'});await page.locator('[data-ev-start]').click();
  await page.evaluate(()=>{const m=document.getElementById('menu-flow-modal');m.dataset.flow='ev';document.getElementById('ev-video-start').hidden=true;const f=document.getElementById('menu-flow-frame');f.hidden=false;f.src='/ev/predictor.html';});
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame').contentWindow.location.pathname.includes('predictor'));
  const frame=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();await frame.waitForFunction(()=>!!window.GameFrameEvDialogs);
  await frame.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());actualMapStage='points';document.getElementById('setup-modal').showModal();document.getElementById('actual-field-map-modal').showModal();});
  await frame.waitForFunction(()=>document.getElementById('setup-modal').classList.contains('ev-dialog-inactive'));
  assert.equal(await page.locator('#menu-flow-close').isVisible(),false);
  assert.equal(await frame.locator('button:visible').filter({hasText:/^Close$/}).count(),1);
  await frame.locator('#actual-field-map-modal .ev-dialog-close').click();
  await page.waitForFunction(()=>!document.getElementById('menu-flow-modal').open);
  console.log('PASS one visible EV dialog, one Close control, and Close exits the wrapper.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
