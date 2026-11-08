// UI fixtures verify review/export scheduling, not detector accuracy.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage();let encodes=0;const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const prediction=JSON.parse(fs.readFileSync(path.resolve('demo-output/reviewed-staged-latest.json')));
 await page.route('**/api/predict',route=>route.fulfill({json:prediction}));
 await page.route('**/api/clip',route=>{encodes++;return route.fulfill({json:{job_id:'speed-ui-fixture'}});});
 await page.route('**/api/clip/status?id=speed-ui-fixture',route=>route.fulfill({json:{status:'done',progress:1,download_url:'/fixture.mp4'}}));
 try{
  await page.goto('http://127.0.0.1:8000/ev/predictor.html?ev_hit_id=85',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.contactTime!==null&&els.video.readyState>=2,{},{timeout:90000});
  await page.evaluate(prediction=>{state.latestPrediction=prediction;workflowReviewRequested=false;goToWorkflowStep('player');},prediction);
  await page.waitForTimeout(1000);
  assert.equal(encodes,0,'Opening review must not render video');
  const prepared=await page.evaluate(()=>prepareClippedVideo());
  assert.equal(encodes,1,'Explicit preparation should render once');
  assert.equal(prepared.job_id,'speed-ui-fixture');
  await page.evaluate(()=>prepareClippedVideo());
  assert.equal(encodes,1,'Repeated save preparation should reuse the completed render');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({review_encodes:0,explicit_encodes:encodes,errors,saved_records_written:false}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
