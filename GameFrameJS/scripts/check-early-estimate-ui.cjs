const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const {spawnSync}=require('node:child_process');
async function waitCount(requests,count){
 const deadline=Date.now()+30000;
 while(requests.length<count){if(Date.now()>deadline)throw Error('Timed out waiting for prepared estimate '+count);await new Promise(r=>setTimeout(r,30))}
}
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-early-estimate-'));process.env.DB_PATH=path.join(tmp,'test.db');
 const video=path.join(tmp,'fixture.mp4');
 assert.equal(spawnSync(require('ffmpeg-static'),['-y','-v','error','-f','lavfi','-i','color=c=green:s=1280x720:r=30','-t','5','-c:v','libx264','-pix_fmt','yuv420p',video]).status,0);
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),requests=[],releases=[],errors=[],backgrounds=[];
  page.on('pageerror',e=>errors.push(e.message));
  const fixture=JSON.parse(fs.readFileSync('demo-output/estimate-performance/baseline.json','utf8'));
  await page.route('**/fixture.mp4',route=>route.fulfill({body:fs.readFileSync(video),contentType:'video/mp4'}));
  await page.route('**/api/predict',async route=>{
   const pkg=route.request().postDataJSON();
   if(pkg._prepare_background_only){backgrounds.push(pkg);return route.fulfill({json:{method:'background_preparation',prepared:true}})}
   requests.push(pkg);
   if(requests.length<=2)await new Promise(resolve=>releases.push(resolve));
   await route.fulfill({json:{...fixture,test_distance:pkg.hit.distance_observation.distance_ft}});
  });
  await page.route('**/api/gameframe/preload-contact',route=>route.fulfill({status:202,json:{ok:true}}));
  await page.route('**/api/landmarks',route=>route.fulfill({json:{landmarks:[]}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/ev/predictor.html`,{waitUntil:'commit',timeout:60000});
  await page.waitForFunction(()=>typeof scheduleEarlyEstimatePreparation==='function');
  await page.evaluate(()=>{els.video.src='/fixture.mp4';els.video.load()});
  await page.waitForFunction(()=>els.video.videoWidth>0);
  await page.evaluate(()=>{
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());
   state.fileName='early-fixture.mp4';state.videoMetadata={width_px:1280,height_px:720,duration_s:5};state.contactTime=1;
   actualFieldMapState.fieldGeometry={source:'actual_field_map',camera_xy_ft:{x:-10,y:-40},landing_xy_ft:{x:-85,y:295},landing_distance_ft:307,landing_angle_deg:-16};
   state.observations=[{role:'CONTACT_POINT',relative_time_s:0,video_time_s:1,image_x:940,image_y:450,source:'HUMAN'},
     {relative_time_s:.333,video_time_s:1.333,image_x:750,image_y:300,source:'HUMAN'}];
   state.detectionAccepted=true;state.landmarks=[];
   goToWorkflowStep('landmarks');
  });
  await waitCount(backgrounds,1);
  await page.waitForFunction(()=>!fieldSuggestionLoading);
  assert.equal(requests.length,0,'only camera evidence is prepared before field marks are confirmed');
  assert.equal(await page.evaluate(()=>state.latestPrediction),null);
  await page.evaluate(()=>{
   state.pendingLandmarks=LANDMARK_SEQUENCE.map((landmark,i)=>({landmark,image_x:300+i*50,image_y:400-i*10,uncertainty_px:45,source:'COMPUTER_VISION',human_reviewed:false}));
   renderWorkflowStep('landmarks');
  });
  await waitCount(requests,1);
  assert.equal(await page.evaluate(()=>state.landmarks.length),0,'preparation cannot accept field suggestions');
  assert.equal(await page.evaluate(()=>state.latestPrediction),null,'speculative results cannot be displayed');
  await page.evaluate(()=>{acceptLandmarkSuggestions();goToWorkflowStep('groundChoice')});
  assert.equal(requests.length,1,'confirmation of identical geometry should reuse prepared work');
  await page.evaluate(()=>{window.consumedEstimate=runLivePrediction({openModal:false})});
  releases[0]();await page.evaluate(()=>window.consumedEstimate);
  assert.equal(requests.length,1,'Estimate must join prepared work rather than start it again');
  assert.equal(await page.evaluate(()=>state.latestPrediction.test_distance),307);
  await page.evaluate(()=>{actualFieldMapState.fieldGeometry.landing_distance_ft=312;markPredictionStale()});
  await waitCount(requests,2);
  await page.evaluate(()=>{actualFieldMapState.fieldGeometry.landing_distance_ft=317;markPredictionStale()});
  releases[1]();await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>state.latestPrediction),null,'a stale prepared distance must never be displayed');
  await page.evaluate(()=>runLivePrediction({openModal:false}));
  assert.equal(await page.evaluate(()=>state.latestPrediction.test_distance),317);
  assert.equal(requests.at(-1).hit.distance_observation.distance_ft,317);
  const beforeRevision=requests.length;
  await page.evaluate(()=>{state.landmarks[0].image_x+=15;markPredictionStale()});
  await waitCount(requests,beforeRevision+1);
  await page.evaluate(()=>runLivePrediction({openModal:false}));
  assert.equal(requests.length,beforeRevision+1,'moving a field mark must invalidate the prepared geometry without duplicate requests');
  assert.equal(requests.at(-1).landmarks[0].image_x,315);
  assert.deepEqual(errors,[]);
  console.log('PASS camera preparation before field review, speculative field preparation without accepting marks, confirmed request joining, stale-distance protection, and normal recalculation.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase()}
})().catch(e=>{console.error(e);process.exitCode=1});
