// Real, continuous Playwright video. Tutorial writes use the isolated server.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),kind=process.argv[2]||'walkthrough';
const out=path.join(root,'demo-output/instruction-continuous/recordings',process.env.RECORDING_TAKE||kind);
const session=JSON.parse(fs.readFileSync(path.join(root,'demo-output/gameframe-20261106/session.json')));
const base=process.env.TUTORIAL_BASE_URL||'http://127.0.0.1:8011',sleep=ms=>new Promise(r=>setTimeout(r,ms));
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 const viewport={width:Number(process.env.RECORD_WIDTH||1200),height:Number(process.env.RECORD_HEIGHT||900)};
 const context=await browser.newContext({viewport,recordVideo:{dir:out,size:viewport},serviceWorkers:'block'});
 await context.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const c=document.createElement('div');c.id='tutorial-pointer';c.style.cssText='position:fixed;width:14px;height:14px;border:2px solid white;background:#0a716b;border-radius:50%;box-shadow:0 1px 4px #0008;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);left:-50px;top:-50px';document.body.append(c);addEventListener('pointermove',e=>{const host=document.querySelector('dialog[open]:not(.ev-dialog-inactive)')||document.body;if(c.parentNode!==host)host.append(c);c.style.left=e.clientX+'px';c.style.top=e.clientY+'px'});addEventListener('pointerdown',()=>c.animate([{outline:'0px solid #fff9'},{outline:'10px solid #fff0'}],{duration:450}));});});
 const page=await context.newPage();page.setDefaultTimeout(120000);
 const events=[],errors=[];const start=Date.now();
 page.on('pageerror',e=>errors.push(e.message));
 const mark=async label=>{events.push({label,seconds:(Date.now()-start)/1000});console.log(label);await page.screenshot({path:path.join(out,label+'.png')});};
 const click=async selector=>{const el=typeof selector==='string'?page.locator(selector):selector;await el.waitFor({state:'visible'});await el.scrollIntoViewIfNeeded();const b=await el.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:24});await sleep(450);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await sleep(950);};
 const select=async(selector,value)=>{await click(selector);await page.keyboard.press('Escape');await page.locator(selector).selectOption(String(value));await sleep(1400);};
 const frame=async index=>{await click('#frame_modal_slider');await page.keyboard.press('Home');for(let i=0;i<index;i++)await page.keyboard.press('ArrowRight');await sleep(1200);};
 try{
 if(kind==='walkthrough'){
  await page.goto(base+'/ev/predictor.html');await page.waitForFunction(()=>typeof loadVideoFile==='function'&&els.gameframeTeam.options.length>1);
  await click('#open-video-picker');await mark('choose-video');
  const chooser=page.waitForEvent('filechooser');await click('#video-picker-modal button[onclick]');await(await chooser).setFiles(session.source_path);
  await page.locator('#ev-people-modal').waitFor({state:'visible'});await mark('choose-hitter');await select('#gameframe-team','20');await select('#gameframe-hitter','8');
  await page.locator('#actual-field-map-modal').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#actual-field-saved-location').options.length>1);await mark('field-address');
  const options=await page.locator('#actual-field-saved-location option').evaluateAll(es=>es.map(e=>({value:e.value,text:e.textContent})));
  const field=options.find(o=>/Cortland|Byrne/i.test(o.text));if(!field)throw Error('Cortland saved location unavailable');await select('#actual-field-saved-location',field.value);await click('#actual-map-continue');
  await sleep(2500);
  const g=session.pack.hit.distance_observation.actual_field_map;
  const box=await page.locator('#actual-field-map').boundingBox();
  const center={lat:(g.home_lat_lng.lat+g.landing_lat_lng.lat)/2,lng:(g.home_lat_lng.lng+g.landing_lat_lng.lng)/2};
  for(let n=0;n<16;n++){
   const pt=await page.evaluate(ll=>{const p=actualFieldMapState.map.latLngToContainerPoint(ll);return{x:p.x,y:p.y}},center);
   const dx=Math.max(-box.width*.35,Math.min(box.width*.35,box.width/2-pt.x)),dy=Math.max(-box.height*.35,Math.min(box.height*.35,box.height/2-pt.y));if(Math.abs(dx)<3&&Math.abs(dy)<3)break;
   const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();for(let s=1;s<=24;s++){await page.mouse.move(x+dx*s/24,y+dy*s/24);await sleep(25)}await page.mouse.up();await sleep(900);
  }
  for(const key of ['camera_lat_lng','home_lat_lng','axis_lat_lng','landing_lat_lng']){
   const pt=await page.evaluate(ll=>{const p=actualFieldMapState.map.latLngToContainerPoint(ll);return{x:p.x,y:p.y}},g[key]);if(pt.x<5||pt.y<5||pt.x>box.width-5||pt.y>box.height-5)throw Error('Map point outside viewport: '+key);
   await page.mouse.move(box.x+pt.x,box.y+pt.y,{steps:30});await sleep(700);await page.mouse.click(box.x+pt.x,box.y+pt.y);await sleep(1700);
  }
  await mark('map-the-field');await sleep(3500);if(process.env.MAP_ONLY==='1')return;await click('#actual-map-continue');
  await page.locator('#workflow-contact-timing').waitFor({state:'visible'});await page.waitForFunction(()=>!contactSuggestionBusy);await mark('check-contact');
  fs.writeFileSync(path.join(out,'contact-state.json'),JSON.stringify(await page.evaluate(()=>({time:els.video.currentTime,body:document.body.innerText,metadata:state.videoMetadata})),null,2));
  await sleep(5000);
  await select('#workflow-contact-timing','BETWEEN_FRAMES');await click('#forward-frame');await mark('between-frames');await sleep(4000);
  await select('#workflow-contact-timing','ON_FRAME');await click('#back-frame');await sleep(2000);
  const point=async(x,y,dragFrom)=>{
   const p=await page.evaluate(({x,y})=>{const r=els.overlay.getBoundingClientRect(),p=videoToDisplayPoint(x,y);return{x:r.left+p.x,y:r.top+p.y}},{x,y});
   if(dragFrom){const q=await page.evaluate(({x,y})=>{const r=els.overlay.getBoundingClientRect(),p=videoToDisplayPoint(x,y);return{x:r.left+p.x,y:r.top+p.y}},dragFrom);await page.mouse.move(q.x,q.y,{steps:25});await sleep(500);await page.mouse.down();for(let i=1;i<=30;i++){await page.mouse.move(q.x+(p.x-q.x)*i/30,q.y+(p.y-q.y)*i/30);await sleep(25)}await page.mouse.up();}
   else{await page.mouse.move(p.x,p.y,{steps:30});await sleep(700);await page.mouse.click(p.x,p.y)}await sleep(1500);
  };
  await point(938.46,449.63);await mark('detect-ball-path');
  await page.locator('#native-auto-yes').waitFor({state:'visible',timeout:1200000});await mark('review-ball-path');await sleep(10000);await click('#native-auto-yes');
  await page.locator('#workflow-use-field-suggestions-top').waitFor({state:'visible',timeout:240000});await mark('review-field-marks');
  fs.writeFileSync(path.join(out,'detected-field.json'),JSON.stringify(await page.evaluate(()=>state.pendingLandmarks),null,2));
  const corrected=[['home_plate',986.41,603.77],['first_baseline_near',1128,573],['first_baseline_far',1250,548],['third_baseline_near',700,578],['third_baseline_far',150,532]];
  for(const [name,x,y] of corrected){const from=await page.evaluate(name=>{const p=state.pendingLandmarks.find(p=>p.landmark===name);return p?{x:p.image_x,y:p.image_y}:null},name);if(!from)throw Error('Missing detector suggestion: '+name);if(Math.hypot(from.x-x,from.y-y)>4)await point(x,y,from);else {await page.mouse.move((await page.locator('#overlay').boundingBox()).x+10,120,{steps:20});await sleep(1500)}}
  await mark('corrected-field-marks');await sleep(10000);
  // Leave the detector's rubber candidate for visual verification, rather than
  // moving it to the superseded lower-leg coordinate from the old tutorial.
  if(process.env.RECORD_REVIEW_ONLY==='1')return;
  const rubber=await page.evaluate(()=>state.pendingLandmarks.find(p=>p.landmark==='pitching_rubber'));
  if(!rubber||rubber.estimate_kind!=='MOUND_TOP_APPROXIMATION')throw Error('Rubber suggestion requires independent visual review before confirmation.');
  await click('#workflow-use-field-suggestions-top');await mark('first-ground-contact');await sleep(6500);await click('#setup-secondary');
  await page.waitForFunction(()=>activeWorkflowStep==='player'&&state.latestPrediction,null,{timeout:1200000});await mark('prediction-review');await sleep(10000);
  fs.writeFileSync(path.join(out,'measurement.json'),JSON.stringify(await page.evaluate(()=>JSON.parse(JSON.stringify(buildPackage(),(key,value)=>/image_data_url|evidence_image/.test(key)?undefined:value))),null,2));
  const save=page.locator('#setup-continue');
  if(await save.isEnabled()){
   await mark('save-hit');await click('#setup-continue');await page.waitForURL(url=>url.pathname==='/upload/swing/trim'&&url.searchParams.has('pending_id'),{timeout:240000});
   await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0);await mark('swing-handoff');await sleep(8000);
   const contact=Number(await page.locator('#frame_modal_slider').getAttribute('max'));
   await click('#swing_step_confirm');await frame(Math.max(0,contact-5));await mark('swing-commitment');await sleep(9000);await click('#swing_step_confirm');await frame(Math.max(0,contact-20));await mark('swing-first-move');await sleep(8000);await click('#swing_step_confirm');await page.waitForURL('**/matchup/select**',{timeout:240000});await mark('saved-swing');await sleep(9000);
  }else{await mark('review-required');}
 } else if(kind==='timing'){
  await page.goto(base+'/multi-swing/pending/tag?id='+(process.env.PENDING_ID||session.pending_swing_id)+'&embedded=1');await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0);
  const contact=Number(await page.locator('#frame_modal_slider').getAttribute('max'));
  const landscape=await page.evaluate(()=>frames[0].width>frames[0].height);
  if(landscape){const b=await page.locator('#frame_modal_canvas').boundingBox(),x=b.x+b.width*.5,y=b.y+b.height*.5;await page.mouse.move(x,y,{steps:25});await page.mouse.down();for(let n=1;n<=30;n++){await page.mouse.move(x+b.width*.24*n/30,y);await sleep(30)}await page.mouse.up();}
  await mark('set-crop');await sleep(6000);await click('#swing_step_confirm');
  await mark('commitment');await frame(Math.max(0,contact-5));await sleep(8000);await click('#swing_step_confirm');
  await mark('first-move');await frame(Math.max(0,contact-20));await sleep(7000);await click('#swing_step_confirm');await page.waitForURL('**/matchup/select**',{timeout:240000});await sleep(2500);await mark('saved-timing');await sleep(7000);
 } else if(kind==='overview'){
  await page.goto(base+'/');await mark('choose-task');await sleep(12000);
  await click(page.getByText('View saved videos',{exact:true}));await sleep(5000);await mark('saved-videos');await sleep(10000);
 }
 if(kind==='results'||kind==='timing'){
  await page.goto(base+'/matchup/select?embedded=1');await page.locator('#pitch_clip').waitFor({state:'visible'});await select('#pitch_clip',session.pitch_id);await mark('choose-pitch');await sleep(4000);await click('#matchup-next');await select('#swing_clip',session.swing_id);await mark('choose-swing');await sleep(4500);await click('#matchup-next');await mark('matchup-review');await sleep(6000);
  await page.goto(base+'/play/matchup?id='+session.matchup_id+'&embedded=1');await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await mark('matchup-playback');
  if(await page.locator('video').first().evaluate(v=>v.paused)){const b=await page.locator('video').first().boundingBox();await page.mouse.move(b.x+25,b.y+b.height-25,{steps:20});await page.mouse.click(b.x+25,b.y+b.height-25)}
  await sleep(17000);
  await page.goto(base+'/dashboard/player?hid=8&tid=20');await mark('timing-dashboard');await sleep(11000);
  await page.goto(base+'/library?embedded=1');await mark('saved-library');await sleep(10000);
 }
 }catch(e){errors.push(e.stack);await mark('failure');fs.writeFileSync(path.join(out,'failure-state.json'),JSON.stringify({url:page.url(),body:await page.locator('body').innerText()},null,2));console.error(e);process.exitCode=1;
 }finally{fs.writeFileSync(path.join(out,'events.json'),JSON.stringify({kind,events,errors,url:page.url()},null,2));await context.close();const raw=fs.readdirSync(out).find(n=>n.startsWith('page@')&&n.endsWith('.webm'));if(raw)fs.copyFileSync(path.join(out,raw),path.join(out,'continuous.webm'));console.log('Saved '+out);await Promise.race([browser.close(),sleep(8000)]);process.exit(process.exitCode||0);}
})().catch(e=>{console.error(e);process.exitCode=1});
