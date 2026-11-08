// Fresh real detector run through the normal wizard. No detector response fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:8000',out=path.resolve(__dirname,'../../demo-output/ball-assist-lab');
(async()=>{
 const hit=(await(await fetch(base+'/library/data?type=ev')).json()).find(h=>h.id===73);
 const original=await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text();
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];let finalJob,seed;
  page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(/\/api\/ball-assist\/jobs\//.test(r.url())&&r.request().method()==='GET'){const j=await r.json();if(j.state==='done')finalJob=j;}if(r.url().endsWith('/api/ball-assist/detect'))seed=r.request().postDataJSON();});
  await page.goto(base+'/ev/predictor.html?ev_hit_id=73',{waitUntil:'domcontentloaded',timeout:90000});await page.waitForFunction(()=>state.contactTime!==null&&els.video.readyState>=2,{},{timeout:90000});
  await page.evaluate(time=>{goToWorkflowStep('contact');seekVideoTo(time);},hit.contact_time_s-hit.clip_start_time_s);await page.waitForFunction(()=>!els.video.seeking&&els.video.readyState>=2);
  const click=await page.evaluate(()=>{const p=videoToDisplayPoint(1117.81,411.33),r=els.overlay.getBoundingClientRect();return{x:p.x*r.width/els.overlay.width,y:p.y*r.height/els.overlay.height};});
  await page.locator('#overlay').click({position:click});console.log('Fresh detector started from normal contact click');
  await page.waitForFunction(()=>['review','manual'].includes(nativeBallAssist.phase),{},{timeout:400000});
  const report=await page.evaluate(()=>({phase:nativeBallAssist.phase,points:nativeBallAssist.points,contact:state.contactTime,status:els.autoTrackStatus.textContent}));
  report.errors=errors;report.seed=seed;report.job=finalJob?.id;report.model_fingerprint=finalJob?.result?.model_fingerprint;report.detection_frames=finalJob?.result?.sampling?.detection_frame_count;report.accuracy_claim=false;
  if(report.phase==='review'){
   await page.waitForFunction(()=>!els.video.seeking&&els.video.readyState>=2);await page.screenshot({path:path.join(out,'normal-real-review.png')});
   await page.locator('#native-auto-yes').click();await page.waitForFunction(()=>els.setupModal.dataset.step==='landmarks');report.accepted_into_normal_workflow=true;
   assert.equal(await page.evaluate(()=>state.observations.filter(p=>p.source==='COMPUTER_VISION').length),report.points.length);
  }
  assert.deepEqual(errors,[]);assert.equal(await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text(),original);report.saved_hit_unchanged=true;
  fs.writeFileSync(path.join(out,'normal-real-scan.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,points:report.points.length}));assert.equal(report.phase,'review','A real scan must reach review for this integration check');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
