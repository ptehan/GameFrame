const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gf-selection-preload-'));process.env.DB_PATH=path.join(directory,'test.db');
 const video=path.join(directory,'fixture.mp4');assert.equal(spawnSync(require('ffmpeg-static'),['-y','-v','error','-f','lavfi','-i','color=c=green:s=320x180:r=30','-t','5','-c:v','libx264',video]).status,0);
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),sessions=new Map(),requests=[];let decodeCount=0,detectCount=0,prewarmCount=0;
  await page.route('**/api/gameframe/video-timing',route=>route.fulfill({json:{fps:30,frame_step_assumption_s:1/30,frame_times_s:Array.from({length:151},(_,i)=>i/30)}}));
  await page.route('**/api/gameframe/preload-contact',route=>{prewarmCount++;const body=route.request().postDataJSON();if(body.preload_time_s!==undefined)assert.equal(body.package.hit.contact,null);return route.fulfill({status:202,json:{ok:true}})});
  await page.route('**/api/ball-assist/session',async route=>{
   const body=route.request().postDataBuffer().toString('latin1');const value=name=>new RegExp('name="'+name+'"\\r\\n\\r\\n([^\\r]+)').exec(body)?.[1];
   const start=Number(value('start')),id='prepared-'+(requests.length+1);requests.push({start,source:value('session'),upload:body.includes('name="video"')});
   const times=Array.from({length:35},(_,i)=>start+i/30),session={id,start,times,frameNumbers:times.map(t=>Math.round(t*30)),width:320,height:180,sourceFps:30,fps:6,frameStride:5,launchFrameCount:35};sessions.set(id,session);await route.fulfill({json:session});
  });
  await page.route('**/api/ball-assist/session/*/contact',route=>{const id=route.request().url().split('/').at(-2),source=sessions.get(id),time=route.request().postDataJSON().time,index=source.times.reduce((best,t,i)=>Math.abs(t-time)<Math.abs(source.times[best]-time)?i:best,0);const view={...source,id:id+'-view',times:source.times.slice(index),frameNumbers:source.frameNumbers.slice(index),launchFrameCount:source.launchFrameCount-index};sessions.set(view.id,view);return route.fulfill({json:view});});
  await page.route('**/api/ball-assist/detect',route=>{detectCount++;const data=route.request().postDataJSON();assert.equal(data.contact.frame,0);return route.fulfill({status:202,json:{id:data.session}})});
  await page.route('**/api/ball-assist/jobs/*',route=>route.fulfill({json:{state:'done',result:{points:[1,8].map(frame=>({frame,x:100,y:60,stabilized_x:100,stabilized_y:60}))}}}));
  await page.goto(`http://127.0.0.1:${server.address().port}/ev/predictor.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof startSelectionPreparation==='function');
  await page.evaluate(()=>{
   window.audioDecodes=0;window.AudioContext=class{async decodeAudioData(){window.audioDecodes++;const data=new Float32Array(48000*5);data[48000*2]=1;return{sampleRate:48000,getChannelData:()=>data}}async close(){}};
  });
  const bytes=[...fs.readFileSync(video)];await page.evaluate(bytes=>loadVideoFile(new File([new Uint8Array(bytes)],'fixture.mp4',{type:'video/mp4'})),bytes);
  await page.waitForFunction(()=>selectionPreparation?.status==='ready');
  assert.equal(await page.evaluate(()=>state.contactTime),null,'preloading cannot confirm contact');assert.equal(detectCount,0,'tracking cannot run before the user marks contact');
  const candidate=await page.evaluate(()=>selectionPreparation.candidate);assert.ok(Math.abs(requests[0].start-(candidate-10/30))<.04);
  assert.ok(await page.evaluate(()=>!!selectionPreparation.session.frameNumbers.length));
  // Manual contact differs from the suggestion but stays inside the prepared window.
  await page.evaluate(async()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());setContactTime(2);state.observations=[{role:'CONTACT_POINT',video_time_s:2,relative_time_s:0,image_x:150,image_y:100,source:'HUMAN'}];await beginNativeBallAssist();});
  assert.equal(requests.length,1,'nearby confirmed contact must reuse preloaded frames');assert.equal(await page.evaluate(()=>state.contactTime),2);
  // A distant manual correction gets new frames from the already uploaded source.
  await page.evaluate(async()=>{setContactTime(3.8);state.observations=[{role:'CONTACT_POINT',video_time_s:3.8,relative_time_s:0,image_x:150,image_y:100,source:'HUMAN'}];await beginNativeBallAssist();});
  assert.equal(requests.length,2);assert.equal(requests[1].upload,false);assert.equal(requests[1].source,'prepared-1');assert.equal(await page.evaluate(()=>state.contactTime),3.8);
  assert.equal(await page.evaluate(()=>window.audioDecodes),1);assert.ok(prewarmCount>=1);
  console.log('PASS selection-time preloading while on the field step, unchanged confirmed contact, numbered-frame reuse, and new windows without re-upload for distant corrections.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
