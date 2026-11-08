// Replay the user's fractional seek with fresh pixels and the real detector.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];let prepared,job;
  page.on('pageerror',e=>errors.push(e.message));
  let sessionId,jobId;page.on('request',r=>{if(r.url().endsWith('/api/ball-assist/detect'))sessionId=r.postDataJSON().session;if(/\/api\/ball-assist\/jobs\//.test(r.url())&&r.method()==='GET')jobId=new URL(r.url()).pathname.split('/').at(-1);});
  await page.goto('http://127.0.0.1:8000/ev/predictor.html',{waitUntil:'domcontentloaded',timeout:90000});
  await page.evaluate(async()=>{
   const response=await fetch('/api/ball-assist/session/d42e55b6-5fde-43c7-94d6-fc7e62d5acef/video'),blob=await response.blob();
   state.videoFile=new File([blob],'1000053313.mp4',{type:'video/mp4'});state.fileName=state.videoFile.name;
   state.videoObjectUrl=URL.createObjectURL(blob);els.video.src=state.videoObjectUrl;els.video.load();state.frameTimes=[];
   setFrameStepFromMetadata({fps:30.000300003000028});state.ballPathAudioStarted=true;goToWorkflowStep('contact');
  });
  await page.waitForFunction(()=>els.video.readyState>=2&&presentedVideoFrame?.source===els.video.currentSrc,{},{timeout:90000});
  await page.evaluate(()=>{goToWorkflowStep('contact');seekVideoTo(2.175334);});
  await page.waitForFunction(()=>!els.video.seeking&&presentedVideoFrame?.time>2.1&&presentedVideoFrame.time<=2.175334);
  const shown=await page.evaluate(()=>displayedFrameTime());console.log('Displayed frame: '+shown);assert.ok(Math.abs(shown-2.166644)<.001);
  const click=await page.evaluate(()=>{const p=videoToDisplayPoint(936.28,447.45),r=els.overlay.getBoundingClientRect();return{x:p.x*r.width/els.overlay.width,y:p.y*r.height/els.overlay.height};});
  await page.locator('#overlay').click({position:click});
  await page.waitForFunction(()=>['review','manual'].includes(nativeBallAssist.phase),{},{timeout:240000});
  console.log(JSON.stringify(await page.evaluate(()=>({phase:nativeBallAssist.phase,status:els.autoTrackStatus.textContent,points:nativeBallAssist.points.length}))));assert.equal(await page.evaluate(()=>nativeBallAssist.phase),'review');prepared=await(await fetch('http://127.0.0.1:8000/api/ball-assist/session/'+sessionId)).json();job=await(await fetch('http://127.0.0.1:8000/api/ball-assist/jobs/'+jobId)).json();assert.ok(Math.abs(prepared.times[0]-shown)<.001);assert.ok(prepared.frameCount<=60);
  const points=await page.evaluate(()=>nativeBallAssist.points);
  const firstSample=points.find(p=>Math.abs(p.video_time_s-2.333309)<.002);assert.ok(firstSample,'Must retain the verified early ball');
  assert.ok(Math.hypot(firstSample.image_x-706,firstSample.image_y-224)<6,'Early mark must be on the ball, not the horizon');
  const matched=points.find(p=>Math.abs(p.video_time_s-2.499974)<.02);assert.ok(matched,'Must find the held-out early ball frame');
  const error=Math.hypot(matched.image_x-574.55,matched.image_y-103.1);assert.ok(error<6,`Held-out ball error ${error}px`);
  await page.waitForFunction(()=>!els.video.seeking);
  await page.evaluate(()=>seekVideoByFrames(1));
  await page.waitForFunction(time=>!els.video.seeking&&Math.abs(presentedVideoFrame.time-time)<.001,points[1].video_time_s);
  await page.evaluate(()=>seekVideoByFrames(-1));
  await page.waitForFunction(time=>!els.video.seeking&&Math.abs(presentedVideoFrame.time-time)<.001,points[0].video_time_s);
  const display=await page.evaluate(()=>{let lines=0;const original=ctx.lineTo;ctx.lineTo=function(...args){lines++;return original.apply(this,args);};try{drawAutoTrackOverlay();}finally{ctx.lineTo=original;}return{lines,current:visibleAutoObservationsNearCurrentTime().length,all:state.autoObservations.length};});
  assert.equal(display.lines,0);assert.equal(display.current,1);assert.ok(display.all>display.current);
  await page.screenshot({path:'demo-output/ball-assist-lab/contact-frame-replay.png'});
  await page.locator('#native-auto-manual').click();await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight10'&&!els.video.seeking);
  await page.locator('#overlay').click({position:{x:400,y:250}});await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight15'&&!els.video.seeking);
  assert.deepEqual(errors,[]);
  const report={passed:true,original_seek_s:2.175334,displayed_frame_s:shown,extracted_contact_s:prepared.times[0],frame_count:prepared.frameCount,proposals:points.length,held_out_error_px:error,overlay:display,manual_intervals_work:true,job:job?.id,errors};
  fs.writeFileSync('demo-output/ball-assist-lab/contact-frame-replay.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
