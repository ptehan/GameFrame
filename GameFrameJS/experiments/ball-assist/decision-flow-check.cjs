// UI fixtures verify branching and transfer, never detector accuracy.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const base='http://127.0.0.1:8000',out=path.resolve(__dirname,'../../demo-output/ball-assist-lab');
(async()=>{
 const library=await(await fetch(base+'/library/data?type=ev')).json(),hit=library.find(r=>r.id===73);
 const meta=JSON.parse(fs.readFileSync(path.join(out,'11a38d2c-fe3a-40bc-afef-dc5a9cea3ec2/session.json')));
 const contactTime=hit.contact_time_s-hit.clip_start_time_s;
 const initialFrame=meta.times.reduce((a,t,i)=>Math.abs(t-contactTime)<Math.abs(meta.times[a]-contactTime)?i:a,0);
 const session={...meta,frameCount:meta.times.length,initialFrame,full:true,sourceHitId:73,sourceTimeOffset:hit.clip_start_time_s};
 assert.equal((await fetch(base+'/test/ball-assist/api/session/'+meta.id)).status,200);
 const original=await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text();
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});const reports=[];
 try{for(const accepted of [false,true]){
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();let seed,detectRequests=0;const errors=[],writes=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')writes.push(new URL(r.url()).pathname);});
  await page.route('**/test/ball-assist/api/from-hit/73',r=>r.fulfill({json:session}));
  await page.route('**/test/ball-assist/api/detect',r=>{seed=r.request().postDataJSON().contact;detectRequests++;return r.fulfill({json:{id:'ui-fixture'}});});
  await page.route('**/test/ball-assist/api/jobs/ui-fixture',r=>r.fulfill({json:{state:'done',result:{contact:seed,scanned_frames:session.frameCount-seed.frame-1,points:[10,15,20].map((gap,i)=>({frame:seed.frame+gap,x:seed.x-50-i*30,y:seed.y-40-i*20,segment:0,status:'unreviewed',evidence:.8})),gaps:[],ground_review:null}}}));
  await page.goto(base+'/test/ball-assist/?hit=73');await page.waitForFunction(()=>document.getElementById('status').textContent.includes('frames loaded'),{},{timeout:90000});
  await page.locator('#frame').click({position:{x:400,y:300}});
  await page.locator('#decision').waitFor({state:'visible'});assert.equal(detectRequests,1,'Contact should automatically trigger one scan');
  await page.screenshot({path:path.join(out,'decision-review.png')});
  await page.locator(accepted?'#use-detection':'#use-manual').click();
  await page.waitForURL('**/ev/predictor.html?**',{timeout:90000});
  await page.waitForFunction(step=>document.getElementById('setup-modal')?.open&&document.getElementById('setup-modal').dataset.step===step,accepted?'landmarks':'ballPath',{timeout:90000});
  await page.waitForFunction(()=>els.video.readyState>=2&&!els.video.seeking,{},{timeout:30000});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const stateReport=await page.evaluate(()=>({observations:state.observations,accepted:state.ballAssistAccepted,contactTime:state.contactTime,sourcePath:state.videoMetadata.source_path,hasVideoFile:state.videoFile instanceof File,step:document.getElementById('setup-modal').dataset.step,prompt:document.getElementById('workflow-video-prompt')?.textContent}));
  assert.equal(stateReport.observations.length,accepted?4:1);assert.equal(!!stateReport.accepted,accepted);assert.equal(stateReport.hasVideoFile,true);assert.equal(stateReport.sourcePath,undefined);
  assert.ok(Math.abs(stateReport.contactTime-meta.times[seed.frame])<1e-6);
  const pixels=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=18;const ctx=c.getContext('2d');ctx.drawImage(els.video,0,0,32,18);const p=ctx.getImageData(0,0,32,18).data;return [...p].filter((v,i)=>i%4!==3&&v>35).length;});assert.ok(pixels>100,'The tagging video must display a decoded frame');
  assert.deepEqual(errors,[]);assert.equal(writes.some(p=>/save-hit|predict|save-swing/.test(p)),false);
  reports.push({choice:accepted?'accepted':'manual',...stateReport,errors,writes});await page.screenshot({path:path.join(out,accepted?'decision-accepted.png':'decision-manual.png')});await context.close();console.log('Passed '+(accepted?'accepted':'manual')+' branch');
 }
 assert.equal(await(await fetch(base+'/api/gameframe/ev-json?id=73&kind=package')).text(),original);
 fs.writeFileSync(path.join(out,'decision-flow-check.json'),JSON.stringify({passed:true,ui_fixtures_only:true,saved_hit_unchanged:true,reports},null,2));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
