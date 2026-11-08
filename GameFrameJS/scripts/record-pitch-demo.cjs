const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const kind=['matchup','matchup-playback','ev','pitch-export','ev-saved'].includes(process.argv[2])?process.argv[2]:'pitch';
const output = path.join(root, 'demo-output', kind+'-recording-' + Date.now());
fs.mkdirSync(output, {recursive:true});
const reference = JSON.parse(fs.readFileSync(path.join(root,'demo-output/sources/recording-reference.json')));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const context = await browser.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'});
 await context.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
   const cursor=document.createElement('div');
   cursor.id='demo-cursor';
   cursor.style.cssText='position:fixed;left:0;top:0;width:20px;height:20px;border:3px solid #fff;border-radius:50%;background:#087d72;box-shadow:0 0 0 2px #083c36;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';
   document.body.append(cursor);
   addEventListener('pointermove', e=>{cursor.style.left=e.clientX+'px';cursor.style.top=e.clientY+'px';const dialog=document.querySelector('dialog[open]');if(cursor.parentElement!==(dialog||document.body))(dialog||document.body).append(cursor);});
   addEventListener('pointerdown',()=>cursor.animate([{boxShadow:'0 0 0 2px #083c36'},{boxShadow:'0 0 0 18px #20bfb880'},{boxShadow:'0 0 0 2px #083c36'}],{duration:550}));
  });
 });
 const page=await context.newPage();
 const diagnostics=[];
 page.on('pageerror',error=>diagnostics.push({type:'pageerror',message:error.message}));
 page.on('request',request=>{if(request.method()==='POST')diagnostics.push({type:'post',url:request.url()});});
 page.on('requestfailed',request=>diagnostics.push({type:'requestfailed',url:request.url(),error:request.failure()}));
 page.setDefaultTimeout(180000);
 const start=Date.now(), events=[], captures=[];
 let recording=true;
 const capture=(async()=>{
  while(recording){
   const seconds=(Date.now()-start)/1000;
   const file='capture-'+String(captures.length).padStart(6,'0')+'.jpg';
   try{await page.screenshot({path:path.join(output,file),type:'jpeg',quality:85,timeout:15000});captures.push({file,seconds});}catch(error){console.log('Capture skipped: '+error.message.split('\n')[0]);}
   await sleep(80);
  }
 })();
 const mark=label=>{events.push({seconds:(Date.now()-start)/1000,label});console.log(label);};
 const click=async selector=>{
  const el=page.locator(selector);await el.waitFor({state:'visible'});await el.scrollIntoViewIfNeeded();
  const b=await el.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18});await sleep(350);await el.click();await sleep(700);
 };
 const select=async(selector,value)=>{await click(selector);await page.keyboard.press('Escape');await page.locator(selector).selectOption(value);await sleep(1000);};
 try {
  if(kind==='ev-saved'){
   await page.goto('http://localhost:8000/matchup/select?pitch_id=68&swing_id=131&sid=x&embedded=1');
   mark('Continue with the saved swing');await sleep(1600);await click('#matchup-next');
   if(await page.locator('#swing_clip').inputValue()!=='131')throw new Error('Expected the saved demo swing131.');
   mark('Saved swing is ready for matchups');await sleep(3000);await page.screenshot({path:path.join(output,'saved-swing.png')});
   await click('#matchup-next');mark('Review the saved clips');await sleep(3000);
   fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),events,pitch:await page.locator('#pitch_clip').inputValue(),
    swing:await page.locator('#swing_clip').inputValue(),note:'Separate follow-up capture after verifying swing131 was saved; no new matchup created.'},null,2));
  }else if(kind==='pitch-export'){
   await page.goto('http://localhost:8000/library?type=pitch&pitch_id=68&sid=x&embedded=1');
   const card='.card-row[data-type="pitch"][data-id="68"]';
   await page.locator(card+' [data-pitch-speed-export]').waitFor({state:'visible'});
   const alreadySaved=new URL(await page.locator(card+' [data-pitch-speed-export]').getAttribute('href'),page.url()).pathname.startsWith('/download/');
   mark(alreadySaved?'Retrieve the saved pitch speed video':'Export the pitch speed video');await sleep(1500);
   const download=page.waitForEvent('download',{timeout:300000});
   await click(card+' [data-pitch-speed-export]');mark(alreadySaved?'Processing: retrieve saved export':'Processing: render and save pitch speed export');
   const file=await download;await file.saveAs(path.join(output,'pitch-68-speed.mp4'));
   await page.locator(card+' a[href*="/download/pitch-speed"]').waitFor();
   mark('Saved export is ready');await sleep(2200);await page.screenshot({path:path.join(output,'saved-export.png')});
   await click(card+' a[href*="/play/pitch?"]');await page.waitForURL('**/play/pitch*');
   mark('Play the saved pitch speed video');
   await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
   if(await page.locator('video').evaluate(v=>v.paused)){
    const b=await page.locator('video').boundingBox();await page.mouse.move(b.x+24,b.y+b.height-48,{steps:18});await page.mouse.click(b.x+24,b.y+b.height-48);
   }
   await page.waitForFunction(()=>document.querySelector('video')?.ended,{},{timeout:120000});
   await page.screenshot({path:path.join(output,'pitch-closing.png')});await sleep(2000);
   fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),events,playback:await page.locator('video').evaluate(v=>({ended:v.ended,time:v.currentTime,duration:v.duration}))},null,2));
  }else if(kind==='matchup-playback'){
   await page.goto('http://localhost:8000/play/matchup?id=229&sid=x&embedded=1');mark('Play the completed matchup');
   await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
   if(await page.locator('video').first().evaluate(v=>v.paused)){
    const b=await page.locator('video').first().boundingBox();await page.mouse.move(b.x+24,b.y+b.height-48,{steps:18});await page.mouse.click(b.x+24,b.y+b.height-48);
   }
   await page.waitForFunction(()=>document.querySelector('video')?.ended,{},{timeout:90000});await sleep(2000);
   fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),events,playback:await page.locator('video').first().evaluate(v=>({ended:v.ended,time:v.currentTime,duration:v.duration}))},null,2));
  }else if(kind==='ev'){
   const packet=reference.ev.package;
   await page.goto('http://localhost:8000/ev/predictor.html');mark('Pick the hit video');
   await click('#open-video-picker');
   const chooser=page.waitForEvent('filechooser');await click('#video-picker-modal button[onclick]');await(await chooser).setFiles(reference.ev.source);
   await page.locator('#actual-field-saved-location').waitFor({state:'visible'});mark('Select the saved field address');
   await page.waitForFunction(()=>document.querySelector('#actual-field-saved-location').options.length>1);
   const saved=await page.evaluate(home=>{
    const rows=readSavedActualFieldLocations();
    return rows.map((r,i)=>({i,d:Math.hypot(Number(r.lat)-home.lat,Number(r.lon)-home.lng)})).sort((a,b)=>a.d-b.d)[0];
   },packet.camera.actual_field_map.home_lat_lng);
   if(!saved||saved.d>.005)throw new Error('No saved address close enough to the reference field.');
   await select('#actual-field-saved-location',String(saved.i));await click('#actual-map-continue');
   const mapBox=await page.locator('#actual-field-map').boundingBox();
   const marks=packet.camera.actual_field_map;
   mark('Center the field in the satellite view');
   const center={lat:(marks.home_lat_lng.lat+marks.landing_lat_lng.lat)/2,lng:(marks.home_lat_lng.lng+marks.landing_lat_lng.lng)/2};
   for(let attempt=0;attempt<16;attempt++){
    const point=await page.evaluate(ll=>{const p=actualFieldMapState.map.latLngToContainerPoint(ll);return{x:p.x,y:p.y};},center);
    const dx=Math.max(-mapBox.width*.35,Math.min(mapBox.width*.35,mapBox.width/2-point.x));
    const dy=Math.max(-mapBox.height*.35,Math.min(mapBox.height*.35,mapBox.height/2-point.y));
    if(Math.abs(dx)<3&&Math.abs(dy)<3)break;
    const x=mapBox.x+mapBox.width/2,y=mapBox.y+mapBox.height/2;
    await page.mouse.move(x,y);await page.mouse.down();
    for(let step=1;step<=20;step++){await page.mouse.move(x+dx*step/20,y+dy*step/20);await sleep(25);}
    await sleep(200);await page.mouse.up();await sleep(900);
   }
   // Read map projection only; perform each mark with a visible pointer click.
   for(const [key,label] of [['camera_lat_lng','Mark the camera location'],['home_lat_lng','Mark home plate on the map'],['axis_lat_lng','Mark second base on the map'],['landing_lat_lng','Mark where the ball first landed']]){
    mark(label);
    let pt=await page.evaluate(ll=>{const p=actualFieldMapState.map.latLngToContainerPoint(ll);return{x:p.x,y:p.y};},marks[key]);
    if(pt.x<15||pt.y<15||pt.x>mapBox.width-15||pt.y>mapBox.height-15)throw new Error('Reference point outside map. Recenter visibly before recording: '+key);
    await page.mouse.move(mapBox.x+pt.x,mapBox.y+pt.y,{steps:25});await sleep(900);await page.mouse.click(mapBox.x+pt.x,mapBox.y+pt.y);await sleep(1200);
   }
   mark('Confirm the field markings');await page.screenshot({path:path.join(output,'map.png')});await click('#actual-map-continue');
   const tag=async point=>{
    const p=await page.evaluate(point=>{const rect=els.overlay.getBoundingClientRect(),p=videoToDisplayPoint(point.image_x,point.image_y);return{x:rect.left+p.x,y:rect.top+p.y};},point);
    await page.mouse.move(p.x,p.y,{steps:25});await sleep(900);await page.mouse.click(p.x,p.y);await sleep(1100);
   };
   for(const point of packet.landmarks){mark(await page.locator('#setup-title').innerText());await tag(point);}
   const tagged=await page.evaluate(()=>buildPackage().landmarks);
   for(const point of packet.landmarks){const actual=tagged.find(p=>p.landmark===point.landmark);if(!actual||Math.hypot(actual.image_x-point.image_x,actual.image_y-point.image_y)>3)throw new Error('Recorded landmark differs from reference: '+point.landmark);}
   mark('Find and tag contact');await click('#timeline');await page.keyboard.press('Home');
   for(let i=0;i<Math.round(packet.hit.contact.timestamp_s*30);i++)await click('#forward-frame');
   const human=packet.ball_observations.filter(p=>p.source==='HUMAN');
   if(human.length<2)throw new Error('Missing saved manual ball reference points.');
   await tag(human[0]);mark('Tag the ball ten frames later');await tag(human[1]);
   await page.waitForFunction(()=>document.querySelector('#setup-modal').dataset.step==='groundChoice');
   mark('Skip optional ground contact');await click('#setup-secondary');
   mark('Enter team, hitter and description');await select('#workflow-gameframe-team','20');await select('#workflow-gameframe-hitter','8');
   await click('#workflow-hit-description');await page.locator('#workflow-hit-description').pressSequentially('CODEX DEMO - Hilton EV and swing walkthrough',{delay:40});
   fs.writeFileSync(path.join(output,'observations.json'),JSON.stringify(await page.evaluate(()=>JSON.parse(JSON.stringify(buildPackage(),(key,value)=>/image_data_url|evidence_image/.test(key)?undefined:value))),null,2));
   await page.bringToFront();await click('#setup-continue');mark('Processing: prediction and video');
   await page.waitForFunction(()=>document.querySelector('#ev-complete-modal')?.open || workflowError || document.querySelector('#actual-field-map-modal')?.dataset.stage==='review',{}, {timeout:1200000});
   if(!await page.locator('#ev-complete-modal').isVisible())throw new Error('EV needs review: '+await page.locator('body').innerText());
   mark('Review the conditional estimate and EV video');await page.screenshot({path:path.join(output,'ev-complete.png')});
   fs.writeFileSync(path.join(output,'prediction.json'),JSON.stringify(await page.evaluate(()=>state.latestPrediction),null,2));
   await page.waitForFunction(()=>document.querySelector('#ev-complete-video')?.readyState>=2);
   if(await page.locator('#ev-complete-video').evaluate(v=>v.paused)){
    const b=await page.locator('#ev-complete-video').boundingBox();await page.mouse.move(b.x+24,b.y+b.height-48,{steps:18});await page.mouse.click(b.x+24,b.y+b.height-48);
   }
   await page.waitForFunction(()=>document.querySelector('#ev-complete-video')?.ended,{}, {timeout:90000});
   await page.screenshot({path:path.join(output,'ev-closing.png')});
   await sleep(2000);await click('#ev-complete-timing');mark('Crop the swing');
   await page.locator('#swing_step_confirm').waitFor({state:'visible'});
   const b=await page.locator('#frame_modal_canvas').boundingBox();
   await page.mouse.move(b.x+b.width*.5,b.y+b.height*.5);await page.mouse.down();
   for(let i=1;i<=20;i++){await page.mouse.move(b.x+b.width*(.5+.35*i/20),b.y+b.height*.5);await sleep(35);}await page.mouse.up();
   await click('#swing_step_confirm');mark('Confirm swing commitment');await sleep(2200);await click('#swing_step_confirm');
   mark('Confirm swing start');await sleep(2200);await click('#swing_step_confirm');mark('Processing: save swing timing');
   await page.waitForURL(url=>url.pathname==='/matchup/select',{timeout:180000});await sleep(2000);mark('Swing timing saved');
   fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),events},null,2));
  }else if(kind==='matchup'){
   await page.goto('http://localhost:8000/matchup/select?sid=x&embedded=1');mark('Choose a pitch');await sleep(1600);
   await select('#pitch_team','21');await select('#pitch_pitcher','39');await select('#pitch_clip','68');
   await page.screenshot({path:path.join(output,'choose-pitch.png')});await click('#matchup-next');mark('Choose a swing');
   await select('#swing_team','20');await select('#swing_hitter','8');await select('#swing_clip','130');
   await page.screenshot({path:path.join(output,'choose-swing.png')});await click('#matchup-next');mark('Review the matchup');
   await click('#desc');await page.locator('#desc').pressSequentially('CODEX DEMO - Matchup walkthrough',{delay:45});await sleep(1500);
   await page.screenshot({path:path.join(output,'review.png')});await click('#matchup-create');mark('Processing: create matchup');
   await page.waitForURL('**/play/matchup*',{timeout:300000});mark('Play the completed matchup');
   await page.locator('video').first().waitFor();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
   if(await page.locator('video').first().evaluate(v=>v.paused)){
    const player=await page.locator('video').first().boundingBox();
    await page.mouse.move(player.x+24,player.y+player.height-48,{steps:18});await page.mouse.click(player.x+24,player.y+player.height-48);
   }
   await page.waitForFunction(()=>document.querySelector('video')?.ended,{},{timeout:90000});
   await page.screenshot({path:path.join(output,'playback.png')});
   fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),events},null,2));
  }else{
  await page.goto('http://localhost:8000/upload/pitch?sid=x&embedded=1');
  mark('Pick the pitch video');await sleep(1600);
  const choose=page.locator('label[for=file_input]');const b=await choose.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:18});
  const chooser=page.waitForEvent('filechooser');await choose.click();await (await chooser).setFiles(reference.pitch.source);await sleep(1600);
  await click('#pitch_upload_next');mark('Select team and pitcher');
  await select('#team_select','21');await select('#pitcher_select','39');
  await click('#pitch_upload_next');mark('Set the clip start');await sleep(1200);
  await click('#video_upload_submit');mark('Processing: upload and decode');
  await page.locator('#pitch_modal_description').waitFor({state:'visible'});mark('Set crop and description');
  await click('#pitch_modal_description');await page.locator('#pitch_modal_description').pressSequentially('CODEX DEMO - Pitch speed walkthrough',{delay:45});
  await click('#portrait_crop_zoom');await page.keyboard.press('Home');
  const crop=await page.locator('#frame_modal_canvas').boundingBox();
  await page.mouse.move(crop.x+crop.width*.5,crop.y+crop.height*.5);await page.mouse.down();
  for(let i=1;i<=20;i++){await page.mouse.move(crop.x+crop.width*(.5-.20*i/20),crop.y+crop.height*.5);await sleep(35);}
  await page.mouse.up();
  await sleep(1600);await page.screenshot({path:path.join(output,'crop.png')});
  await click('#pitch_step_confirm');mark('Select contact frame');
  await click('#frame_modal_slider');await page.keyboard.press('End');await sleep(1800);
  const contact=Number(await page.locator('#frame_modal_slider').inputValue());
  if(contact!==119)throw new Error('Unexpected final contact frame: '+contact);
  await page.screenshot({path:path.join(output,'contact.png')});
  await click('#pitch_step_confirm');mark('Processing: save pitch');
  await page.locator('[name=speed_range]').waitFor({state:'visible'});mark('Choose speed range');
  await select('[name=speed_range]','75-85');await click('#pv-preview');mark('Processing: release frames');
  await page.locator('#pv-picker').waitFor({state:'visible'});mark('Review release frames');
  let frame=Number((await page.locator('#pv-before-label').innerText()).match(/\d+/)[0]);
  while(frame!==92){await click(frame<92?'#pv-frame-next':'#pv-frame-prev');frame=Number((await page.locator('#pv-before-label').innerText()).match(/\d+/)[0]);}
  await sleep(1500);await click('#pv-select-half');await sleep(1800);await page.screenshot({path:path.join(output,'release.png')});
  await click('#pv-confirm-release');mark('Review speed and adjust distances');await sleep(1700);
  await click('[name=search_extension_feet]');await page.keyboard.press('ArrowUp');await sleep(1400);await page.keyboard.press('ArrowDown');await sleep(1400);
  await click('[name=search_contact_feet]');await page.keyboard.press('ArrowUp');await sleep(1400);await page.keyboard.press('ArrowDown');await sleep(1400);
  await page.screenshot({path:path.join(output,'speed.png')});
  const speed=await page.locator('#pv-speed').innerText();
  await click('#pv-save');mark('Processing: save speed');
  await page.waitForURL('**/library*');await sleep(3000);mark('Saved pitch in library');
  await page.screenshot({path:path.join(output,'library.png')});await sleep(2500);
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({url:page.url(),speed,contact,events},null,2));
  }
 } catch(error) {
  await page.screenshot({path:path.join(output,'failure.png')});
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:String(error),url:page.url(),events},null,2));throw error;
 } finally {
  recording=false;await capture;
  if(kind==='ev'){
   try{fs.writeFileSync(path.join(output,'prediction.json'),JSON.stringify(await page.evaluate(()=>state.latestPrediction),null,2));}catch(_){}
  }
  fs.writeFileSync(path.join(output,'recording.json'),JSON.stringify({captures,events,diagnostics},null,2));
  console.log('Recording: '+output);await context.close();await browser.close();
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
