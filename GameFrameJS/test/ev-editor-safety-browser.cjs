const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'), out=path.join(root,'demo-output/editor-safety-20261026');fs.mkdirSync(out,{recursive:true});
const video=path.join(out,'fixture.mp4');
const made=spawnSync(require('ffmpeg-static'),['-v','error','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=60','-t','4','-c:v','libx264','-pix_fmt','yuv420p',video]);assert.equal(made.status,0,made.stderr?.toString());
const outer=require('nunjucks').renderString(fs.readFileSync(path.join(root,'templates/base.html'),'utf8'),{ev_predictor_url:'',embedded:false,sid:'test'});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/outer'){res.setHeader('Content-Type','text/html');return res.end(outer);}
 if(url.pathname.startsWith('/api/')){
  res.setHeader('Content-Type','application/json');
  if(url.pathname.endsWith('options'))return res.end(JSON.stringify({teams:[{id:1,name:'Team'}],hitters:[{id:1,name:'Hitter',team_id:1}]}));
  if(url.pathname.endsWith('video-timing'))return res.end(JSON.stringify({fps:60,frame_step_assumption_s:1/60,frame_times_s:Array.from({length:241},(_,i)=>i/60),timing_source:'source_frame_timestamps'}));
  return res.end(JSON.stringify({hits:[],locations:[]}));
 }
 const file=url.pathname==='/fixture.mp4'?video:path.join(root,url.pathname.startsWith('/static/')?url.pathname:'ev-predictor/'+(url.pathname==='/'?'predictor.html':url.pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
 res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.mp4')?'video/mp4':'application/octet-stream');
 fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});const report=[];
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR '+e.message);});
   await page.route('https://**',r=>r.abort());
   await page.addInitScript(()=>document.addEventListener('DOMContentLoaded',()=>{
    initializeActualFieldMap=()=>true;refreshActualFieldMap=()=>{};detectContactFromAudio=async()=>{window.contactSuggestionCalls=(window.contactSuggestionCalls||0)+1;seekVideoTo(.75);els.contactAudioStatus.textContent="Audio jumped to likely contact";};prepareClippedVideo=async()=>null;
   }));
   console.log('Starting editor checks at width '+width);await page.goto(origin,{waitUntil:'networkidle'});
   await page.locator('#video-file').setInputFiles(video);
   await page.waitForFunction(()=>els.video.readyState>=2 && state.frameStepS===1/60);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#actual-field-map-modal').evaluate(e=>e.open),true);
   await page.evaluate(()=>{setActualMapStage('points');actualMapSetMode('camera');});
   assert.match(await page.locator('#actual-field-map .map-marking-prompt').innerText(),/where you stood/);
   assert.equal(await page.locator('.map-marking-prompt').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
   await page.evaluate(()=>{closeActualFieldMapModal();goToWorkflowStep('contact');});
   await page.waitForFunction(()=>window.contactSuggestionCalls===1 && !els.video.seeking && Math.abs(els.video.currentTime-.75)<.001);
   assert.equal(await page.locator('#workflow-recording-fps').count(),0);
   assert.equal(await page.locator('#setup-title').innerText(),'Mark contact');
   const compact=await page.locator('#setup-controls-slot').boundingBox();assert.ok(compact.height<=100,JSON.stringify(compact));
   await page.screenshot({path:path.join(out,`contact-${width}.png`)});
   await page.evaluate(()=>{renderWorkflowStep('contact');seekVideoTo(1);});
   assert.equal(await page.evaluate(()=>window.contactSuggestionCalls),1);
   await page.waitForFunction(()=>!els.video.seeking);
   await page.locator('#workflow-contact-timing').selectOption('BETWEEN_FRAMES');
   assert.match(await page.locator('.workflow-video-prompt').innerText(),/first frame after contact/);
   await page.locator('#overlay').click({position:{x:180,y:180}});
   await page.waitForFunction(()=>activeWorkflowStep==='ballPath' && !els.video.seeking);
   const first=await page.evaluate(()=>({contact:state.contactTime,frame:state.contactFrameTime,point:state.observations[0]}));
   assert.ok(Math.abs(first.contact-(1-1/120))<1e-6,JSON.stringify(first));assert.equal(first.frame,1);assert.equal(first.point.video_time_s,1);assert.ok(first.point.relative_time_s>0);
   await page.locator('#overlay').click({position:{x:250,y:100}});
   await page.waitForFunction(()=>activeWorkflowStep==='landmarks' && !els.video.seeking);
   assert.match(await page.locator('.workflow-video-prompt').innerText(),/Home Plate/i);
   const flash=await page.evaluate(()=>{
    setWorkflowVideoPrompt("");setWorkflowVideoPrompt("Click home plate");
    const e=document.querySelector('.workflow-video-prompt'),a=e.getBoundingClientRect(),b=e.parentElement.getBoundingClientRect();
    return {centerX:Math.abs(a.x+a.width/2-b.x-b.width/2),centerY:Math.abs(a.y+a.height/2-b.y-b.height/2),pointerEvents:getComputedStyle(e).pointerEvents};
   });
   assert.ok(flash.centerX<2 && flash.centerY<2,JSON.stringify(flash));assert.equal(flash.pointerEvents,'none');
   await page.waitForFunction(()=>document.querySelector('.workflow-video-prompt').hidden);
   assert.equal(await page.locator('.workflow-video-prompt').isVisible(),false);
   await page.keyboard.press('Escape');assert.equal(await page.locator('#setup-modal').evaluate(e=>e.open),true);
   await page.evaluate(()=>{for(const [i,key]of LANDMARK_SEQUENCE.entries()){els.landmarkType.value=key;addLandmark({x:100+i*30,y:200+i*10});}renderWorkflowStep('landmarks');});
   const count=await page.evaluate(()=>state.landmarks.length);assert.equal(count,6);
   await page.screenshot({path:path.join(out,`field-instructions-${width}.png`)});
   for(const selector of ['#setup-back','#setup-continue','#setup-modal .workflow-navigation','#back-frame','#forward-frame']) {
    const box=await page.locator(selector).boundingBox();assert.ok(box && box.x>=0 && box.y>=0 && box.x+box.width<=width+1 && box.y+box.height<=900,selector+' outside viewport '+JSON.stringify(box));
   }
   assert.equal(await page.locator('#setup-modal').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true,'Editor must not overflow horizontally');
   await page.screenshot({path:path.join(out,`field-instructions-${width}.png`)});
   await page.evaluate(()=>{
    window.reviewPredictionCalls=0;window.reviewVideoCalls=0;
    actualFieldMapGeometryReady=()=>true;
    runLivePrediction=async()=>{window.reviewPredictionCalls++;state.latestPrediction={method:'review-test',ev_candidates:[],export_readiness:{allowed:false,title:'Review ready',message:'Prediction shown before video creation'}};els.predictionUnconstrained.textContent='Prediction shown before video creation';return state.latestPrediction;};
    prepareClippedVideo=async()=>{window.reviewVideoCalls++;return null;};
    state.latestPrediction=null;workflowDetailsConfirmed=false;
   });
   await page.locator('#setup-modal .workflow-navigation').getByRole('button',{name:'Review',exact:true}).click();
   await page.waitForFunction(()=>window.reviewPredictionCalls===1 && state.latestPrediction);
   assert.equal(await page.locator('#setup-title').innerText(),'Review the match');
   assert.equal(await page.locator('.workflow-export-combined').isVisible(),true);
   assert.match(await page.locator('.workflow-export-combined').innerText(),/Prediction shown before video creation/);
   assert.equal(await page.evaluate(()=>window.reviewVideoCalls),0);
   await page.evaluate(()=>goToWorkflowStep('groundChoice'));
   assert.equal(await page.locator('#setup-continue').innerText(),'I can see first ground contact');
   assert.equal(await page.locator('#setup-secondary').innerText(),'Not visible');
   assert.equal(await page.locator('#terminal-type option').count(),1);
   await page.locator('#setup-continue').click();await page.evaluate(()=>seekVideoTo(3));await page.waitForFunction(()=>!els.video.seeking);
   await page.locator('#setup-continue').click();
   const landing=await page.evaluate(()=>state.terminalEvent);assert.equal(landing.type,'FIRST_GROUND_CONTACT');assert.equal(landing.image_x,null);assert.equal(landing.image_y,null);
   assert.ok(Math.abs(landing.relative_time_s-(3-first.contact))<1e-6);
   await page.evaluate(()=>{goToWorkflowStep('groundChoice');state.latestPrediction={stale:true};});
   await page.locator('#setup-secondary').click();assert.equal(await page.evaluate(()=>state.terminalEvent),null);assert.equal(await page.evaluate(()=>state.latestPrediction),null);
   await page.evaluate(()=>{goToWorkflowStep('landmarks');persistDraft();});await page.evaluate(()=>GameFrameEvDrafts.flush());
   const saved=await page.evaluate(async()=>{const d=await GameFrameEvDrafts.read();return {count:d.package.landmarks.length,mode:d.package.hit.contact.timing_mode,point:d.package.ball_observations[0]};});
   assert.equal(saved.count,6);assert.equal(saved.mode,'BETWEEN_FRAMES');assert.equal(saved.point.role,'CONTACT_POINT');
   await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Resume unfinished hit',exact:true}).click();
   await page.waitForFunction(()=>state.landmarks.length===6 && els.setupModal.open);
   assert.equal(await page.evaluate(()=>state.contactTimingMode),'BETWEEN_FRAMES');assert.equal(await page.evaluate(()=>state.observations[0].video_time_s),1);
   await page.evaluate(()=>GameFrameEvDrafts.clear());
   assert.deepEqual(errors,[]);report.push({width,checks_passed:true,checks:['map and editor Escape protection','on-image prompts','fractional timing with measured pixels preserved','binary landing selection','frame-only landing has no invented position','skip invalidates stale result','draft survives reload']});
   await context.close();
  }
  const page=await browser.newPage();await page.route('https://**',r=>r.abort());await page.route('**/static/js/app.js',r=>r.abort());
  await page.goto(origin+'/outer',{waitUntil:'networkidle'});
  await page.evaluate(()=>{const frame=document.getElementById('menu-flow-frame');frame.hidden=false;frame.src='/predictor.html';document.getElementById('ev-video-start').hidden=true;document.getElementById('menu-flow-modal').showModal();});
  await page.waitForTimeout(500);const frame=page.frames().find(f=>f.url().endsWith('/predictor.html'));assert.ok(frame);await frame.evaluate(()=>window.keepEditor=42);
  await page.locator('#menu-flow-close').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('#menu-flow-modal').evaluate(e=>e.open),true);
  await page.locator('#menu-flow-close').click();assert.equal(await page.locator('#menu-flow-modal').evaluate(e=>e.open),false);
  await frame.evaluate(()=>{window.failedAttempt=true;state.latestPrediction={distance_review:{required:true}};});
  await page.locator('#open-ev-modeling').click();
  assert.equal(await page.locator('#ev-video-start').isVisible(),true);
  assert.equal(await page.locator('#ev-choose-video').isVisible(),true);
  assert.equal(await page.locator('#menu-flow-frame').isVisible(),false);
  assert.equal(await page.locator('#menu-flow-frame').getAttribute('src'),'about:blank');
  await page.locator('#ev-menu-video').setInputFiles(video);
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame').contentWindow.keepEditor === undefined && document.getElementById('menu-flow-frame').contentWindow.document.getElementById('video')?.readyState>=1);
  const fresh=page.frames().find(f=>f.url().endsWith('/predictor.html'));assert.ok(fresh);
  assert.equal(await fresh.evaluate(()=>state.observations.length),0);
  assert.equal(await fresh.evaluate(()=>state.latestPrediction),null);
  report.push({outer_window:true,checks_passed:true,checks:['Escape cannot unload editor','EV restarts at video selection after a failed attempt']});
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log('PASS editor safety, marking prompts, timing, landing choice, and draft recovery on desktop/mobile; outer EV close/reopen. Report: '+out);
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
