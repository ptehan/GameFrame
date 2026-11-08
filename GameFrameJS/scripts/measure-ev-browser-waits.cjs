const fs=require('node:fs');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(90000);
  const requests=[],active=new Map();
  page.on('request',r=>active.set(r,Date.now()));
  page.on('requestfinished',async r=>{if(r.url().includes('/api/')||r.resourceType()==='media')requests.push({url:r.url(),type:r.resourceType(),seconds:(Date.now()-active.get(r))/1000,status:(await r.response())?.status()});});
  const start=Date.now();await page.goto('http://127.0.0.1:8000/ev/predictor.html',{waitUntil:'commit',timeout:90000});
  await page.waitForFunction(()=>typeof loadSavedEvHitFromDatabase==='function'&&typeof goToWorkflowStep==='function');
  const startupSeconds=(Date.now()-start)/1000;console.log({startupSeconds});
  const open=Date.now();await page.evaluate(()=>loadSavedEvHitFromDatabase(94));
  await page.waitForFunction(()=>els.video.readyState>=2&&els.video.videoWidth>0);
  const savedHitUsableSeconds=(Date.now()-open)/1000;console.log({savedHitUsableSeconds});
  const calculation=Date.now();
  await page.evaluate(()=>{
    document.querySelectorAll('dialog[open]').forEach(d=>d.close());
    cancelBackgroundPrediction();earlyEstimatePreparation?.cancel();earlyRegistrationPreparation?.cancel();
    state.latestPrediction=null;
    goToWorkflowStep('player');
  });
  await page.waitForFunction(()=>!backgroundPredictionPromise&&!livePredictionController&&Boolean(state.latestPrediction));
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const report={scope:'Browser: reopen saved day hit 94, then enter Review with raw marks and no saved prediction/prepared result. Not a new-video workflow or video export.',startupSeconds,savedHitUsableSeconds,recalculateToPaintSeconds:(Date.now()-calculation)/1000,fitCacheHit:await page.evaluate(()=>state.latestPrediction?.direction_first_match?.performance?.fit_cache_hit),requests};
  fs.writeFileSync('demo-output/speed-audit-20261105/browser-waits.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
