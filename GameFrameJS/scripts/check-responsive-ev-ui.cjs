// Scheduling fixtures only: no accuracy claims and no writes to saved hits.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let calls=0,started;const firstStarted=new Promise(resolve=>started=resolve);
 const prediction=JSON.parse(fs.readFileSync('demo-output/reviewed-staged-latest.json'));
 await page.route('**/api/predict',async route=>{
  const index=++calls;if(index===1){started();await new Promise(r=>setTimeout(r,600));}
  await route.fulfill({json:{...prediction,test_generation:index}}).catch(()=>{});
 });
 try{
  await page.goto('http://127.0.0.1:8000/ev/predictor.html?ev_hit_id=85',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>typeof state!=='undefined'&&state.contactTime!==null,{},{timeout:90000});
  const map=JSON.parse(fs.readFileSync('demo-output/speed-benchmark/fresh-input.json')).camera.actual_field_map;
  await page.evaluate(map=>{
   actualMapRedrawLines=()=>{}; // Do not fetch live tiles in a scheduling test.
   Object.assign(actualFieldMapState,{camera:map.camera_lat_lng,home:map.home_lat_lng,axis:map.axis_lat_lng,landing:map.landing_lat_lng,map:{invalidateSize(){}}});
   state.distanceCertainty='area';actualMapStage='review';
   document.querySelectorAll('input[name="landing-certainty"]').forEach(el=>el.checked=el.value==='area');
   window.html2canvas=target=>new Promise(resolve=>{window.frozenMapTarget=target;window.releaseMapCapture=resolve;});
   els.actualFieldMapModal.showModal();actualMapUpdateMeasurements();
  },map);
  const confirmation=await page.evaluate(async()=>{const start=performance.now();const applied=await applyActualFieldMapValues();return {applied,milliseconds:performance.now()-start,closed:!els.actualFieldMapModal.open};});
  assert.equal(confirmation.applied,true);assert.equal(confirmation.closed,true);
  await page.waitForFunction(()=>typeof releaseMapCapture==='function');
  assert.equal(await page.evaluate(()=>frozenMapTarget!==els.actualFieldMap&&frozenMapTarget.isConnected),true,'Capture uses an independent frozen map');
  await page.evaluate(async()=>{
   actualFieldMapState.home={...actualFieldMapState.home,lat:actualFieldMapState.home.lat+.0001};
   const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;releaseMapCapture(canvas);await pendingMapEvidence;
  });
  assert.equal(await page.evaluate(()=>actualFieldMapState.evidenceImageDataUrl),null,'An old capture must not replace revised coordinates');
  await page.evaluate(()=>{window.releaseMapCapture=null;actualMapUpdateMeasurements();queueMapEvidenceCapture();});
  await page.waitForFunction(()=>typeof releaseMapCapture==='function');
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=100;canvas.height=100;releaseMapCapture(canvas);await pendingMapEvidence;});
  assert.equal(await page.evaluate(()=>actualFieldMapState.evidenceImageDataUrl?.startsWith('data:image/jpeg')),true,'A current snapshot should be retained');
  const boundedCapture=await page.evaluate(async()=>{window.html2canvas=()=>new Promise(()=>{});const start=performance.now();queueMapEvidenceCapture();await pendingMapEvidence;return performance.now()-start;});
  assert.ok(boundedCapture<6000,'Unavailable screenshot must not hold export indefinitely');
  await page.evaluate(()=>{window.firstPrediction=runLivePrediction({openModal:false}).then(()=> 'unexpected').catch(e=>e.name);});
  await firstStarted;
  const latest=await page.evaluate(async()=>{await runLivePrediction({openModal:false});return {first:await firstPrediction,generation:state.latestPrediction.test_generation};});
  assert.equal(latest.first,'AbortError');assert.equal(latest.generation,2);
  assert.deepEqual(errors,[]);
  const report={confirmation,stale_map_capture_rejected:true,current_map_capture_retained:true,unavailable_capture_bounded_ms:boundedCapture,obsolete_prediction_aborted:true,latest_response_retained:true,saved_hits_modified:false};
  fs.writeFileSync('demo-output/responsive-ev-ui-check.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
