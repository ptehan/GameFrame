const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const external=null;
const out=path.resolve('demo-output/save-first-20261105');fs.mkdirSync(out,{recursive:true});
const pkg=JSON.parse(fs.readFileSync('demo-output/speed-audit-20261105/raw-input.json','utf8'));
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gameframe-real-workflow-'));process.env.DB_PATH=path.join(tmp,'test.db');
const {startServer,closeDatabase}=external?{}:require('../server');
let phase='startup';const report={database:external?'Library write intercepted; existing production records preserved':'isolated; production records untouched',scope:'Video selection through finished video; automated user marks; user decision time excluded; server already running',source:pkg.video_metadata.source_path,steps:[],requests:[],errors:[]};
(async()=>{
 let server=external?null:startServer(0,'127.0.0.1');if(server)await new Promise(r=>server.listening?r():server.once('listening',r));const base=external||'http://127.0.0.1:'+server.address().port;
 const post=async(p,body)=>{const r=await fetch(base+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d};
 const team=external?{id:20}:(await post('/api/gameframe/team',{name:'Workflow timing test'})).team;
 const hitter=external?{id:8}:(await post('/api/gameframe/hitter',{team_id:team.id,name:'Workflow timing test'})).hitter;
 if(!external)await post('/api/gameframe/field-locations',{location:{label:'Cortland test field',query:'Cortland',lat:42.5554,lon:-76.2376}});
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});page.setDefaultTimeout(120000);
  const started=new Map();page.on('pageerror',e=>report.errors.push(e.message));
  page.on('request',r=>{started.set(r,Date.now());if(r.url().includes('/api/')&&!r.url().includes('/jobs/')&&!r.url().includes('/api/clip/status'))console.log('REQUEST',phase,r.url().split(base)[1])});
  page.on('requestfinished',async r=>{if(r.url().includes('/api/')){const row={phase,url:r.url().split(base)[1],seconds:(Date.now()-started.get(r))/1000,status:(await r.response())?.status()};report.requests.push(row);if(!r.url().includes('/jobs/')&&!r.url().includes('/api/clip/status'))console.log('DONE',JSON.stringify(row));}});
  async function step(name,fn){phase=name;console.log('START',name);const t=Date.now();await fn();const row={name,seconds:(Date.now()-t)/1000};report.steps.push(row);fs.writeFileSync(path.join(out,'trace.json'),JSON.stringify(report,null,2));console.log('STEP',JSON.stringify(row));}
  let interceptedSave=false;
  if(external)await page.route('**/api/gameframe/save-hit',route=>{interceptedSave=true;report.outputJobId=route.request().postDataJSON().clip_job_id;return route.fulfill({status:422,json:{error:'Performance check: finished video generated; no library record written.'}})});
  await page.goto(base+'/ev/predictor.html',{waitUntil:'commit'});await page.waitForFunction(()=>typeof loadVideoFile==='function'&&els.gameframeTeam.options.length>1);
  if(process.env.GAMEFRAME_PERF_LEGACY==='1')await page.evaluate(()=>{
    prepareNativeSource=async(identity,signal)=>{
      if(state.contactTime===null)return null;
      const form=new FormData();form.append('video',state.videoFile,state.fileName||'hit.mp4');
      form.append('mode','contact');form.append('sampled','1');form.append('source_fps',String(1/currentStep()));form.append('start',String(contactCalibrationTime()));
      const response=await fetch('/api/ball-assist/session',{method:'POST',body:form,signal});const data=await response.json();if(!response.ok)throw Error(data.error);return data;
    };
  });
  await step('Choose video to usable video and team selection',async()=>{await page.locator('#video-file').setInputFiles(pkg.video_metadata.source_path);await page.locator('#ev-people-modal').waitFor({state:'visible'});await page.waitForFunction(()=>els.video.readyState>=2)});
  await step('Select team and player to usable map',async()=>{await page.locator('#gameframe-team').selectOption(String(team.id));await page.locator('#gameframe-hitter').selectOption(String(hitter.id));await page.locator('#ev-people-form button[type=submit]').click();await page.locator('#actual-field-map-modal').waitFor({state:'visible'});await page.waitForFunction(()=>actualFieldMapState.map&&els.actualFieldSavedLocation.options.length>1);});
  await step('Replay existing map marks and confirm to contact screen',async()=>{
   await page.evaluate(map=>{actualFieldMapState.map.setView(map.home_lat_lng,18);setActualMapStage('points');actualMapSetMode('camera');for(const key of ['camera_lat_lng','home_lat_lng','axis_lat_lng','landing_lat_lng'])actualMapPlacePoint(L.latLng(map[key]));},pkg.hit.distance_observation.actual_field_map);
   await page.locator('#actual-map-continue').click();await page.waitForFunction(()=>activeWorkflowStep==='contact'&&!contactSuggestionBusy&&!els.video.seeking);
  });
  await step('Confirmed contact to automatic ball review',async()=>{
   await page.evaluate(async t=>{els.video.pause();await waitForVideoSeek(t)},pkg.hit.contact.frame_timestamp_s);
   const point=pkg.ball_observations.find(r=>r.role==='CONTACT_POINT');
   const screen=await page.evaluate(p=>{const b=els.overlay.getBoundingClientRect(),q=videoToDisplayPoint(p.image_x,p.image_y);return{x:b.left+q.x,y:b.top+q.y}},point);
   await page.mouse.click(screen.x,screen.y);await page.waitForFunction(()=>nativeBallAssist.phase==='review'||nativeBallAssist.phase==='manual',null,{timeout:240000});
   const state=await page.evaluate(()=>({phase:nativeBallAssist.phase,points:nativeBallAssist.points.length}));console.log('DETECTION',state);assert.equal(state.phase,'review');
   await page.screenshot({path:path.join(out,'ball-review.png')});
  });
  // No model outputs or saved candidates are supplied. These are the actual
  // source-video marks, replayed as user corrections for repeatable timing.
  await step('Review ball and field marks',async()=>{
   await page.locator('#native-auto-yes').click();await page.waitForFunction(()=>activeWorkflowStep==='landmarks');
   await page.waitForFunction(()=>!fieldSuggestionLoading);
   await page.evaluate(marks=>{for(const row of marks){const existing=state.pendingLandmarks.find(p=>p.landmark===row.landmark);if(existing){existing.image_x=row.image_x;existing.image_y=row.image_y;}}renderWorkflowStep('landmarks')},pkg.landmarks);
   const use=page.locator('#workflow-use-field-suggestions-top');if(await use.isVisible())await use.click();
   else {
    const manual=page.locator('#workflow-manual-field-top');if(await manual.isVisible())await manual.click();
    for(const mark of pkg.landmarks){
     await page.evaluate(m=>{els.landmarkType.value=m.landmark},mark);
     const p=await page.evaluate(m=>{const b=els.overlay.getBoundingClientRect(),q=videoToDisplayPoint(m.image_x,m.image_y);return{x:b.left+q.x,y:b.top+q.y}},mark);
     await page.mouse.click(p.x,p.y);
    }
   }
   await page.waitForFunction(()=>activeWorkflowStep==='groundChoice');
  });
  await step('Finish prompts to visible estimate',async()=>{await page.locator('#setup-secondary').click();await page.waitForFunction(()=>activeWorkflowStep==='player'&&state.latestPrediction&&!backgroundPredictionPromise&&!livePredictionController,null,{timeout:240000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:path.join(out,'estimate.png')});report.result=await page.evaluate(()=>({best:bestPredictionRow(),detectedPoints:nativeBallAssist.points.length}));});
  let savedId;
  await step('Save hit until source replay and swing timing are available',async()=>{
   await page.locator('#setup-continue').click();
   await page.locator('#ev-complete-modal').waitFor({state:'visible'});
   const completion=await page.evaluate(()=>({id:state.gameframe.savedHitId,status:state.gameframe.videoRenderStatus,pendingSwingId:state.gameframe.pendingSwingId,error:workflowError,downloadDisabled:document.getElementById('ev-complete-download').disabled}));
   console.log('COMPLETION',completion);assert.ok(completion.id);assert.ok(completion.pendingSwingId);assert.ok(['queued','rendering'].includes(completion.status));assert.equal(completion.downloadDisabled,true);assert.equal(completion.error,'');savedId=completion.id;report.completion=completion;
   await page.waitForFunction(()=>document.getElementById('ev-complete-video').readyState>=2);
   await page.screenshot({path:path.join(out,'saved-while-rendering.png')});
  });
  await step('Continue into swing timing while video renders',async()=>{
   await page.locator('#ev-complete-timing').click();
   await page.waitForURL(url=>url.pathname==='/upload/swing/trim'&&url.searchParams.has('pending_id'),{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0&&!swingTagBusy,null,{timeout:60000});
   report.timingUrl=page.url();await page.screenshot({path:path.join(out,'timing-while-rendering.png')});
  });
  const prior=await(await fetch(base+'/api/gameframe/ev-video-status?id='+savedId)).json();assert.ok(['queued','rendering'].includes(prior.status));
  await browser.close();
  await step('Restart processing and finish the saved video without a browser',async()=>{
   const port=server.address().port;await new Promise(r=>server.close(r));require('../experiments/ball-assist/server.cjs').stopModels();
   server=startServer(port,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
   let result;const deadline=Date.now()+240000;
   while(Date.now()<deadline){const response=await fetch(base+'/api/gameframe/ev-video-status?id='+savedId);result=await response.json();if(result.status==='ready'||result.status==='error')break;await new Promise(r=>setTimeout(r,1000));}
   assert.equal(result.status,'ready',JSON.stringify(result));report.background=result;
   const hits=await(await fetch(base+'/api/gameframe/ev-hits')).json();assert.equal(hits.hits.length,1,'Restart must not duplicate the measurement');
   const video=await fetch(base+'/stream/ev-clip?id='+savedId+'&kind=generated');assert.equal(video.status,200);fs.writeFileSync(path.join(out,'finished-video.mp4'),Buffer.from(await video.arrayBuffer()));
   report.backgroundRecoveredAfterRestart=true;
  });

 }catch(e){report.failure={phase,message:e.message};console.error(e);process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'trace.json'),JSON.stringify(report,null,2));await browser.close();if(server){await new Promise(r=>server.close(r));require('../experiments/ball-assist/server.cjs').stopModels();closeDatabase();}}
})().catch(e=>{console.error(e);process.exitCode=1});
