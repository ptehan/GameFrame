const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-contact-ui-'));process.env.DB_PATH=path.join(temp,'test.db');
 const video=path.join(temp,'fixture.mp4');
 const encoded=spawnSync(require('ffmpeg-static'),['-y','-v','error','-f','lavfi','-i','color=c=green:s=960x540:r=30','-t','4','-c:v','libx264','-pix_fmt','yuv420p',video]);
 assert.equal(encoded.status,0,encoded.stderr?.toString());
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  let preloadCount=0,detectCount=0,releaseDetection,secondStarted;
  const secondRequestStarted=new Promise(resolve=>secondStarted=resolve);
  await page.route('**/fixture.mp4',route=>{
   const bytes=fs.readFileSync(video),range=route.request().headers().range;
   if(!range)return route.fulfill({body:bytes,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'}});
   const match=/bytes=(\d+)-(\d*)/.exec(range),start=Number(match[1]),end=match[2]?Number(match[2]):bytes.length-1;
   return route.fulfill({status:206,body:bytes.subarray(start,end+1),contentType:'video/mp4',headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Accept-Ranges':'bytes'}});
  });
  await page.route('**/api/gameframe/preload-contact',route=>{preloadCount++;return route.fulfill({status:202,json:{ok:true}})});
  const names=['home_plate','pitching_rubber','first_baseline_near','first_baseline_far','third_baseline_near','third_baseline_far'];
  await page.route('**/api/landmarks',async route=>{
   detectCount++;
   const payload=route.request().postDataJSON();assert.equal(payload.frame_time_s,2);
   if(detectCount===4)return route.fulfill({status:500,json:{error:'test detection failure'}});
   if(detectCount===2)await new Promise(r=>{releaseDetection=r;secondStarted();});
   await route.fulfill({json:{landmarks:names.map((landmark,i)=>({landmark,image_x:250+i*65,image_y:300-i*20,uncertainty_px:landmark==='pitching_rubber'?72:30,
    ...(landmark==='pitching_rubber'?{estimate_kind:'MOUND_TOP_APPROXIMATION',rubber_visible:false}:{} )}))}});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/ev/predictor.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof scheduleContactPreload==='function');
  await page.evaluate(()=>{
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());
   els.video.src='/fixture.mp4';els.video.load();
  });
  await page.waitForFunction(()=>document.querySelector('video').videoWidth>0);
  await page.evaluate(()=>{
   state.fileName='fixture.mp4';state.videoMetadata={source_path:'fixture.mp4'};
   actualFieldMapState.fieldGeometry={camera_xy_ft:{x:15,y:-40}};
   state.observations=[{role:'CONTACT_POINT',relative_time_s:0,video_time_s:2,image_x:550,image_y:370,source:'HUMAN'},
    {relative_time_s:.333,video_time_s:2.333,image_x:450,image_y:270,source:'HUMAN',human_reviewed:true}];
   setContactTime(2);activeWorkflowStep='contact';
  });
  await page.waitForFunction(()=>state.pendingLandmarks.length===6);
  assert.equal(preloadCount,1);assert.equal(detectCount,1);
  assert.equal(await page.evaluate(()=>state.landmarks.length),0,'suggestions must not count as accepted');
  await page.evaluate(()=>goToWorkflowStep('landmarks'));
  await page.locator('#workflow-use-field-suggestions-top').waitFor({state:'visible'});
  await page.waitForFunction(()=>!els.video.seeking);
  const position=await page.evaluate(()=>{const r=els.overlay.getBoundingClientRect(),p=videoToDisplayPoint(state.pendingLandmarks[0].image_x,state.pendingLandmarks[0].image_y);return{x:r.left+p.x,y:r.top+p.y}});
  await page.mouse.move(position.x,position.y);await page.mouse.down();await page.mouse.move(position.x+25,position.y+10,{steps:4});await page.mouse.up();
  assert.notEqual(await page.evaluate(()=>state.pendingLandmarks[0].image_x),250,'drag must change the suggested marker');
  assert.equal(await page.evaluate(()=>normalizeLandmarkRows(state.pendingLandmarks).find(r=>r.landmark==='pitching_rubber').estimate_kind),'MOUND_TOP_APPROXIMATION');
  const confirmBox=await page.locator('#workflow-use-field-suggestions-top').boundingBox();
  assert.ok(confirmBox.y+confirmBox.height<300,'confirmation belongs in the visible top action bar');
  // Correct just the rubber without discarding the other five suggestions.
  await page.evaluate(()=>{els.landmarkType.value='pitching_rubber';});
  const correction=await page.evaluate(()=>{const r=els.overlay.getBoundingClientRect(),p=videoToDisplayPoint(650,280);return{x:r.left+p.x,y:r.top+p.y}});
  await page.mouse.click(correction.x,correction.y);
  assert.equal(await page.evaluate(()=>state.pendingLandmarks.some(r=>r.landmark==='pitching_rubber')),false);
  await page.locator('#workflow-use-field-suggestions-top').click();
  assert.equal(await page.evaluate(()=>state.landmarks.length),6);
  assert.equal(await page.evaluate(()=>state.landmarks.every(r=>r.human_reviewed&&r.calibration_time_s===2)),true);
  assert.ok(await page.evaluate(()=>Math.abs(state.landmarks.find(r=>r.landmark==='pitching_rubber').image_x-650)<1),'confirmation must retain the corrected rubber');
  assert.equal(await page.evaluate(()=>activeWorkflowStep),'groundChoice');
  // Reject an in-flight request. Late suggestions must not replace manual marks.
  await page.evaluate(()=>{state.landmarks=[];state.observations[0].image_x=560;scheduleContactPreload();goToWorkflowStep('landmarks');});
  await page.waitForFunction(()=>fieldSuggestionLoading);
  await secondRequestStarted;
  await page.locator('#workflow-manual-field-top').click();
  releaseDetection();
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>state.pendingLandmarks.length),0);
  await page.waitForFunction(()=>!els.video.seeking);
  await page.waitForFunction(()=>!els.video.seeking&&Math.abs(els.video.currentTime-contactCalibrationTime())<.02);
  const overlay=await page.locator('#overlay').boundingBox();
  await page.mouse.click(overlay.x+overlay.width*.5,overlay.y+overlay.height*.7);
  if (!await page.evaluate(()=>state.landmarks.length)) console.log(await page.evaluate(()=>({step:activeWorkflowStep,mode:els.clickMode.value,time:els.video.currentTime,contact:contactCalibrationTime(),seeking:els.video.seeking,dialog:els.setupModal.open,suppressed:suppressFieldMarkerClick,prompt:els.setupTitle.textContent,body:document.elementFromPoint(innerWidth*.5,innerHeight*.5)?.outerHTML?.slice(0,200)})));
  assert.equal(await page.evaluate(()=>state.landmarks.length),1,'manual tagging must still add marks');
  assert.equal(preloadCount,2,'revised contact point must invalidate preload/detection key');
  const original=await page.evaluate(()=>JSON.stringify(state.landmarks));
  await page.locator('#workflow-detect-field-top').click();
  await page.waitForFunction(()=>state.pendingLandmarks.length===6);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.landmarks)),original,'existing marks must stay until acceptance');
  await page.locator('#workflow-manual-field-top').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(state.landmarks)),original,'rejection must preserve existing marks');
  await page.locator('#workflow-detect-field-top').click();
  await page.waitForFunction(()=>!fieldSuggestionLoading&&fieldSuggestionMessage.includes('test detection failure'));
  assert.equal(await page.locator('#workflow-detect-field-top').isVisible(),true,'failed detection must offer retry');
  await page.locator('#workflow-detect-field-top').click();
  await page.waitForFunction(()=>state.pendingLandmarks.length===6);
  await page.locator('#workflow-use-field-suggestions-top').click();
  assert.equal(await page.evaluate(()=>state.landmarks.length),6,'accepted suggestions replace matching names without duplicates');
  assert.deepEqual(errors,[]);
  console.log('PASS contact preloading, automatic review, marker dragging, acceptance, rejection during detection, and manual fallback.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
