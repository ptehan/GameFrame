// Explicit detector fixtures: tests real EV wizard controls, not detection accuracy.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:8000',out=path.resolve(__dirname,'../../demo-output/ball-assist-lab');
(async()=>{
 const hits=await(await fetch(base+'/library/data?type=ev')).json(),hit=hits.find(h=>h.id===73),meta=JSON.parse(fs.readFileSync(path.join(out,'11a38d2c-fe3a-40bc-afef-dc5a9cea3ec2/session.json'))),session={...meta,frameCount:meta.times.length};
 const original=await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text();
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});const reports=[];
 try{for(const choice of (process.env.BALL_ASSIST_CHOICES||'yes,no,failure,cancel').split(',')){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();const errors=[],calls=[];let seed,jobDeletes=0;
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('request',r=>{if(r.method()==='POST')calls.push({url:new URL(r.url()).pathname,data:r.url().endsWith('/detect')?r.postDataJSON():undefined});});
  await page.route('**/api/ball-assist/session',r=>choice==='failure'?r.fulfill({status:503,json:{error:'Detection unavailable (fixture)'}}):r.fulfill({json:session}));
  await page.route('**/api/ball-assist/detect',r=>{seed=r.request().postDataJSON().contact;return r.fulfill({json:{id:'native-fixture'}});});
  await page.route('**/api/ball-assist/jobs/native-fixture',r=>{if(r.request().method()==='DELETE'){jobDeletes++;return r.fulfill({json:{state:'cancelled'}});}return r.fulfill({json:choice==='cancel'?{state:'running',progress:{completed:1,total:180}}:{state:'done',result:{points:[10,15,20].map((gap,i)=>({frame:seed.frame+gap,x:seed.x-50-i*30,y:seed.y-50-i*15,stabilized_x:seed.x-50-i*30,stabilized_y:seed.y-50-i*15}))}}});});
  await page.goto(base+'/ev/predictor.html?ev_hit_id=73',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>state.contactTime!==null&&els.video.readyState>=2,{},{timeout:90000});
  await page.evaluate(time=>{goToWorkflowStep('contact');seekVideoTo(time);},hit.contact_time_s-hit.clip_start_time_s);
  await page.waitForFunction(()=>!els.video.seeking&&els.video.readyState>=2,{},{timeout:90000});
  const click=await page.evaluate(()=>{const p=videoToDisplayPoint(1117.81,411.33),r=els.overlay.getBoundingClientRect();return{x:p.x*r.width/els.overlay.width,y:p.y*r.height/els.overlay.height};});
  await page.locator('#overlay').click({position:click});
  if(choice==='cancel'){
   await page.waitForFunction(()=>nativeBallAssist.job!==null);await page.locator('#native-auto-manual').click();
  }else if(choice!=='failure'){
   await page.waitForFunction(()=>['review','manual'].includes(nativeBallAssist.phase),{},{timeout:90000});
   assert.equal(await page.evaluate(()=>nativeBallAssist.phase),'review',JSON.stringify(await page.evaluate(()=>({status:els.autoTrackStatus.textContent,points:nativeBallAssist.points,phase:nativeBallAssist.phase}))));
   await page.locator('#native-auto-yes').waitFor({state:'visible'});await page.waitForFunction(()=>!els.video.seeking);
   const checkVisible=async()=>{const visible=await page.evaluate(()=>{const modal=els.setupModal.getBoundingClientRect();return ['#native-auto-yes','#native-auto-manual'].every(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return r.top>=modal.top&&r.left>=0&&r.bottom<=Math.min(innerHeight,modal.bottom)&&r.right<=innerWidth;});});assert.equal(visible,true,'Decision and playback controls must fit without scrolling');};
   await checkVisible();assert.equal(await page.locator('#workflow-viewer-slot .transport').isVisible(),false);
   const drawn=await page.evaluate(()=>{let count=0;const arc=ctx.arc;ctx.arc=function(...args){count++;return arc.apply(this,args);};try{drawContactReviewPicture();}finally{ctx.arc=arc;}return count;});assert.equal(drawn,4,'All three detections and contact should be on one picture');
   if(choice==='no'){await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await checkVisible();await page.screenshot({path:path.join(out,'normal-auto-mobile.png')});await page.setViewportSize({width:1440,height:900});}
   await page.screenshot({path:path.join(out,'normal-auto-review.png')});
   await page.locator(choice==='yes'?'#native-auto-yes':'#native-auto-manual').click();
  }
  if(choice==='failure')await page.waitForFunction(()=>nativeBallAssist.phase==='manual',{},{timeout:90000}).catch(async error=>{console.error(await page.evaluate(()=>({phase:nativeBallAssist.phase,busy:contactSuggestionBusy,contact:state.contactTime,status:els.autoTrackStatus.textContent,observations:state.observations})));throw error;});
  await page.waitForFunction(step=>els.setupModal.open&&els.setupModal.dataset.step===step,choice==='yes'?'landmarks':'ballPath');
  const first=await page.evaluate(()=>({observations:state.observations,auto:state.autoObservations.length,accepted:state.detectionAccepted,phase:nativeBallAssist.phase,readiness:ballDetectionSeedReadiness(),contact:state.contactTime}));
  assert.equal(first.observations.length,choice==='yes'?4:1);assert.equal(first.accepted,choice==='yes');
  assert.equal(calls.filter(c=>c.url.endsWith('/session')).length,1,'One contact click starts one scan');
  assert.equal(calls.some(c=>/test\/ball-assist/.test(c.url)),false);assert.equal(page.url().includes('/ev/predictor.html'),true);
  if(choice==='yes'){
   assert.equal(first.observations.filter(p=>p.source==='COMPUTER_VISION').length,3);
   assert.ok(first.observations.filter(p=>p.source==='COMPUTER_VISION').every(p=>p.human_reviewed===true));
   assert.equal(await page.evaluate(()=>buildPackage().ball_observations.filter(p=>p.source==='COMPUTER_VISION'&&p.human_reviewed===true).length),3);
  }
  else{
   assert.equal(first.readiness.markKey,'flight10');assert.equal(first.auto,0);
   await page.waitForFunction(()=>!els.video.seeking&&els.video.readyState>=2);
   await page.locator('#overlay').click({position:{x:450,y:250}});
   await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight15');
   await page.waitForFunction(()=>!els.video.seeking);await page.evaluate(()=>skipCurrentVideoMark());
   await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight20');await page.waitForFunction(()=>!els.video.seeking);
   await page.locator('#overlay').click({position:{x:400,y:200}});
   const later=await page.evaluate(()=>({observations:state.observations,skipped:state.skippedVideoMarks,readiness:ballDetectionSeedReadiness(),phase:nativeBallAssist.phase}));
   assert.equal(later.observations.length,3);assert.ok(later.observations.every(p=>p.source==='HUMAN'));assert.ok(later.skipped.includes('flight15'));assert.equal(later.readiness.markKey,'flight25');assert.equal(later.phase,'manual');
   assert.equal(calls.filter(c=>c.url.endsWith('/session')).length,1,'Interval marks must not restart detection');
   await page.screenshot({path:path.join(out,'normal-interval-tagging.png')});
   await page.locator('#setup-continue').click();await page.waitForFunction(()=>els.setupModal.dataset.step==='landmarks');
   if(choice==='cancel'){await page.waitForTimeout(600);assert.ok(jobDeletes>0);}
  }
  assert.deepEqual(errors,[]);assert.equal(calls.some(c=>/save-hit|predict|save-swing/.test(c.url)),false);
  reports.push({choice,passed:true,errors,calls,contact:first.contact});console.log('Passed normal workflow: '+choice);await context.close();
 }
 assert.equal(await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text(),original);
 fs.writeFileSync(path.join(out,'normal-workflow-check.json'),JSON.stringify({passed:true,fixtures_only:true,saved_hit_unchanged:true,reports},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
