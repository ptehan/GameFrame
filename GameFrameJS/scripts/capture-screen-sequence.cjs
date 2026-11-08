// Capture current UI states using an isolated snapshot of the working database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Database=require('better-sqlite3');
const {spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=process.env.CAPTURE_OUTPUT_DIR?path.resolve(process.env.CAPTURE_OUTPUT_DIR):path.join(root,'demo-output','screen-sequence');
fs.mkdirSync(out,{recursive:true});
const only=process.argv[2]||'';
const previous=only&&fs.existsSync(path.join(out,'manifest.json'))?JSON.parse(fs.readFileSync(path.join(out,'manifest.json'))):null;
const entries=previous?.entries||[],failures=[];
const originalOrder=new Map(entries.map((e,i)=>[e.title,i]));
const mapTitles=['Camera position','Home plate on map','Second base on map','Landing point on map'];
const groupFor={'EV sequence':'Measure a hit','EV completion':'EV completion','Map sequence':'Map sequence','EV playback':'EV playback','Pitch sequence':'Measure a pitch','Swing sequence':'Tag a swing','Matchup sequence':'Create a matchup'};
if(only){for(let i=entries.length-1;i>=0;i--)if(entries[i].group===groupFor[only]||entries[i].group==='Capture problems'||(only==='EV completion'&&entries[i].title==='EV video saved')||(only==='EV playback'&&entries[i].title==='Saved hit playback'))entries.splice(i,1);}
if(only==='EV media'){for(let i=entries.length-1;i>=0;i--)if(mapTitles.includes(entries[i].title)||entries[i].title==='Saved hit playback')entries.splice(i,1);}
if(only==='Tutorial finishing'){for(let i=entries.length-1;i>=0;i--)if(entries[i].group==='Measure a pitch'||['EV video saved','Ground-contact visibility'].includes(entries[i].title))entries.splice(i,1);}
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function main(){
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-screen-sequence-'));
 const source=new Database(process.env.CAPTURE_DB_PATH||path.join(root,'app.db'),{readonly:true});
 process.env.DB_PATH=path.join(temp,'snapshot.db');await source.backup(process.env.DB_PATH);source.close();
 const {startServer,closeDatabase}=require('../server');
 const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 const db=new Database(process.env.DB_PATH);
 const requestedHit=Number(process.env.CAPTURE_HIT_ID||0);
 const hit=requestedHit?db.prepare('SELECT * FROM ev_hit_tracks WHERE id=?').get(requestedHit):db.prepare('SELECT * FROM ev_hit_tracks WHERE observation_package_json IS NOT NULL AND prediction_json IS NOT NULL ORDER BY id DESC LIMIT 1').get();
 const pack=JSON.parse(hit.observation_package_json),prediction=JSON.parse(hit.prediction_json);
 const matchup=requestedHit?db.prepare('SELECT DISTINCT m.* FROM matchups m JOIN ev_swing_links l ON l.swing_clip_id=m.swing_clip_id WHERE l.ev_hit_id=? ORDER BY m.id DESC LIMIT 1').get(requestedHit):db.prepare('SELECT * FROM matchups ORDER BY id DESC LIMIT 1').get();
 const pitch=matchup?db.prepare('SELECT * FROM pitch_clips WHERE id=?').get(matchup.pitch_clip_id):db.prepare('SELECT * FROM pitch_clips ORDER BY id DESC LIMIT 1').get();
 const swing=matchup?db.prepare('SELECT * FROM swing_clips WHERE id=?').get(matchup.swing_clip_id):db.prepare('SELECT * FROM swing_clips ORDER BY id DESC LIMIT 1').get();
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(45000);
 if(process.env.CAPTURE_DEBUG){
  let logs=0;page.on('console',m=>{if(logs++<80)console.log('PAGE '+m.text());});
  await page.route('**/static/js/guided-workspace.js*',route=>{
   let body=fs.readFileSync(path.join(root,'static/js/guided-workspace.js'),'utf8');
   body=body.replace('function layout() {','function layout() {console.log("LAYOUT START");');
   body=body.replace('secondaryActions();','console.log("BEFORE ACTIONS");secondaryActions();console.log("AFTER ACTIONS");');
   body=body.replace("const ensure=()=>{","const ensure=()=>{console.log('ENSURE '+select.id);");
   return route.fulfill({contentType:'application/javascript',body});
  });
 }
 const shot=async(group,title,note='',extra={})=>{
  console.log('SCREENSHOT START '+title);
  await page.waitForTimeout(350);console.log('TAKING IMAGE '+title);
  const file=String(entries.length+1).padStart(2,'0')+'-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'')+'.jpg';
  await page.screenshot({path:path.join(out,file),type:'jpeg',quality:88,timeout:10000,animations:'disabled'});
  entries.push({group,title,note,file,url:page.url(),...extra});console.log('CAPTURE '+entries.length+' '+group+' / '+title);writeGallery();
 };
 const goto=async route=>{console.log('NAVIGATE '+route);await page.goto(base+route,{waitUntil:'domcontentloaded',timeout:20000});console.log('DOM READY '+route);await page.waitForLoadState('networkidle',{timeout:5000}).catch(()=>{});};
 const task=async(name,fn)=>{if(only&&only!==name&&!(only==='EV media'&&['Map sequence','EV playback'].includes(name))&&!(only==='Related workflows'&&['EV completion','Pitch sequence','Swing sequence','Matchup sequence'].includes(name))&&!(only==='Tutorial finishing'&&['EV completion','Pitch sequence'].includes(name))&&!(only==='Supporting pages'&&!groupFor[name]))return;try{await fn();}catch(e){failures.push({name,error:e.message});console.error('CAPTURE FAILED '+name+': '+e.message.split('\n')[0]);await shot('Capture problems',name+' - current screen',e.message.split('\n')[0]).catch(()=>{});}};
 const click=async selector=>{const el=page.locator(selector);await el.focus();try{await el.click({timeout:3000});}catch(e){console.log('CONTROL CLIPPED '+selector);await el.evaluate(e=>e.click());}};
 const media=async(target,selector='video')=>{await target.locator(selector).first().waitFor();await target.waitForFunction(sel=>document.querySelector(sel)?.readyState>=2,selector,{timeout:25000}).catch(()=>{});};
 const proxy=(blob,name)=>{
  const input=path.join(temp,name+'-original.mp4'),output=path.join(temp,name+'.mp4');fs.writeFileSync(input,blob);
  const result=spawnSync(require('ffmpeg-static'),['-v','error','-i',input,'-vf','scale=640:360:force_original_aspect_ratio=decrease:force_divisible_by=2','-an','-c:v','libx264','-preset','ultrafast','-crf','22',output],{windowsHide:true,timeout:90000});
  if(result.status!==0)throw new Error('Could not prepare screenshot footage: '+result.stderr);return output;
 };
 try{
 if(!only){await goto('/?sid=x');await shot('Start','Home');}
 await task('EV sequence',async()=>{
  if(only)await goto('/?sid=x');
  await page.locator('[data-ev-start]').click();await shot('Measure a hit','Choose hit video');
  await page.locator('#ev-menu-video').setInputFiles(pack.video_metadata.source_path);
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame')?.contentWindow?.location.pathname.includes('predictor'));
  const frame=await (await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>typeof state!=='undefined'&&els.video.videoWidth>0,{timeout:45000});
  await frame.evaluate(async()=>{await loadGameFrameOptions();});
  await frame.locator('#actual-field-map-modal').waitFor({state:'visible'});
  await shot('Measure a hit','Field address');
  await frame.evaluate(p=>{loadPackageIntoState(p);initializeActualFieldMap();setActualMapStage('points');},pack);
  await frame.waitForFunction(()=>!!actualFieldMapState.map);
  const geometry=pack.hit?.distance_observation?.actual_field_map||pack.camera?.actual_field_map;
  console.log('MAP GEOMETRY KEYS '+Object.keys(geometry||{}).join(','));
  await frame.evaluate(g=>{actualMapResetPoints();actualFieldMapState.map.fitBounds([g.home_lat_lng,g.landing_lat_lng,g.camera_lat_lng],{padding:[70,70],maxZoom:20,animate:false});},geometry);
  for(const [mode,title] of [['camera','Camera position'],['home','Home plate on map'],['axis','Second base on map'],['landing','Landing point on map']]){
   await frame.evaluate(m=>actualMapSetMode(m),mode);
   await page.waitForTimeout(1200);
   await shot('Measure a hit',title,'Map marking sequence; saved field geometry is available in this replay.');
   await frame.evaluate(({g,m})=>actualMapPlacePoint(L.latLng(g[m+'_lat_lng'])),{g:geometry,m:mode});
  }
  await frame.evaluate(()=>setActualMapStage('confirm'));
  await shot('Measure a hit','Landing certainty');
  await frame.evaluate(p=>{if(els.actualFieldMapModal.open)els.actualFieldMapModal.close();loadPackageIntoState(p);const time=state.contactFrameTime||state.contactTime;state.observations=[];state.contactTime=null;goToWorkflowStep('contact');seekVideoTo(time);},pack);
  await frame.waitForFunction(()=>!els.video.seeking);await shot('Measure a hit','Contact on the bat');
  const observations=pack.ball_observations||[];
  for(const [count,title] of [[1,'Ball at 10 frames'],[2,'Ball at 15 frames'],[3,'Ball at 20 frames'],[4,'Additional ball marks']]){
   if(observations.length<count)continue;
   await frame.evaluate(({p,count})=>{loadPackageIntoState(p);state.observations=state.observations.slice(0,count);state.skippedVideoMarks=[];goToWorkflowStep('ballPath');},{p:pack,count});
   await frame.waitForFunction(()=>!els.video.seeking);
   await shot('Measure a hit',title,count===4?'Optional later marks repeat at the same interval; Continue moves to field marking.':'');
  }
  for(let i=0;i<6;i++){
   await frame.evaluate(({p,i})=>{loadPackageIntoState(p);state.landmarks=state.landmarks.slice(0,i);goToWorkflowStep('landmarks');},{p:pack,i});
   await frame.waitForFunction(()=>!els.video.seeking);
   const title=await frame.locator('#setup-title').innerText();await shot('Measure a hit','Field mark '+(i+1)+' - '+title);
  }
  await frame.evaluate(()=>goToWorkflowStep('groundChoice'));await shot('Measure a hit','Can you see ground contact');
  await frame.evaluate(()=>goToWorkflowStep('ground'));await shot('Measure a hit','Ground contact frame','Optional Yes branch. No continues directly to the estimate.');
  await frame.evaluate(({p,result})=>{loadPackageIntoState(p);state.latestPrediction=result;renderDirectPredictionCard(els.predictionUnconstrained,result);prepareClippedVideo=async()=>null;goToWorkflowStep('player');},{p:pack,result:prediction});
  await shot('Measure a hit','Prediction and video','Existing saved estimate #'+hit.id+' shown to capture the completed layout; this is not a new model test.');
  await goto('/play/ev?id='+hit.id+'&sid=x&embedded=1');await media(page);await shot('Measure a hit','Saved hit playback');
 });
 await task('EV completion',async()=>{
  await goto('/?sid=x');await page.locator('[data-ev-start]').click();
  await page.evaluate(()=>{document.getElementById('ev-video-start').hidden=true;const frame=document.getElementById('menu-flow-frame');frame.hidden=false;frame.src='/ev/predictor.html';});
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame')?.contentWindow?.location.pathname.includes('predictor'));
  const frame=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>typeof state!=='undefined');
  const savedLink=db.prepare('SELECT pending_swing_id FROM ev_swing_links WHERE ev_hit_id=? ORDER BY rowid DESC LIMIT 1').get(hit.id);
  await frame.evaluate(({id,pending})=>{
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());
   state.gameframe.savedHitId=id;state.gameframe.pendingSwingId=pending;showEvCompletion();
  },{id:hit.id,pending:savedLink?.pending_swing_id||null});
  await media(frame,'#ev-complete-video');
  await frame.waitForFunction(()=>{const v=document.getElementById('ev-complete-video');return v.readyState>=2&&v.videoWidth>0;},null,{timeout:90000});
  await frame.locator('#ev-complete-video').evaluate(v=>{if(Number.isFinite(v.duration))v.currentTime=Math.min(2,v.duration*.2);});
  await frame.waitForFunction(()=>!document.getElementById('ev-complete-video').seeking);
  await shot('Measure a hit','EV video saved','Save completion screen, using the existing saved video. Finish swing timing continues into the swing workflow.');
  if(only==='Tutorial finishing'||only==='Related workflows'){
   await frame.evaluate(()=>{document.getElementById('ev-complete-video').pause();document.querySelectorAll('dialog[open]').forEach(d=>d.close());goToWorkflowStep('groundChoice');});
   await frame.waitForFunction(()=>!!window.GameFrameEvDialogs);
   await page.waitForTimeout(100);
   const labels=await frame.locator('#setup-modal button:visible').allTextContents();
   if(labels.map(x=>x.trim()).sort().join(',')!=='No,Yes')throw new Error('Ground choice should show only Yes and No: '+labels);
   await shot('Measure a hit','Ground-contact visibility','If first ground contact is visible, tag its frame with half-frame precision. This saved Cortland hit has no ground-contact tag.');
  }
 });
 await task('Map sequence',async()=>{
  await goto('/?sid=x');await page.locator('[data-ev-start]').click();
  await page.evaluate(()=>{document.getElementById('ev-video-start').hidden=true;const frame=document.getElementById('menu-flow-frame');frame.hidden=false;frame.src='/ev/predictor.html';});
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame')?.contentWindow?.location.pathname.includes('predictor'));
  const frame=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>typeof state!=='undefined');
  const geometry=pack.hit?.distance_observation?.actual_field_map||pack.camera?.actual_field_map;
  await frame.evaluate(({p,g})=>{
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());loadPackageIntoState(p);initializeActualFieldMap();actualMapResetPoints();
   els.actualFieldMapModal.showModal();setActualMapStage('points');actualFieldMapState.map.invalidateSize();
   actualFieldMapState.map.fitBounds([g.home_lat_lng,g.landing_lat_lng,g.camera_lat_lng],{padding:[70,70],maxZoom:18,animate:false});
  },{p:pack,g:geometry});
  for(const [mode,title] of [['camera','Camera position'],['home','Home plate on map'],['axis','Second base on map'],['landing','Landing point on map']]){
   await frame.evaluate(m=>actualMapSetMode(m),mode);await page.waitForTimeout(2000);
   await shot('Measure a hit',title);
   await frame.evaluate(({g,m})=>actualMapPlacePoint(L.latLng(g[m+'_lat_lng'])),{g:geometry,m:mode});
  }
 });
 await task('EV playback',async()=>{
  await goto('/library?type=ev&sid=x');
  const card=page.locator(`#library_grid .card-row[data-type="ev"][data-id="${hit.id}"]`);
  await card.waitFor();await card.locator('details.library-details').evaluate(e=>e.open=true);
  const play=card.locator(`[data-ev-play="${hit.id}"]`);await play.focus();await play.click();
  await page.locator('#ev-library-player[open]').waitFor();await media(page,'#ev-library-player video');
  await page.locator('#ev-library-player video').evaluate(v=>{if(Number.isFinite(v.duration))v.currentTime=Math.min(2,v.duration*.2);});
  await page.waitForFunction(()=>!document.querySelector('#ev-library-player video').seeking);
  await shot('Measure a hit','Saved hit playback','Library playback of the existing saved hit.');
 });
 await task('Pitch sequence',async()=>{
  await goto('/upload/pitch?sid=x&embedded=1');await shot('Measure a pitch','Choose pitch video');
  const pitchFile=proxy(pitch.clip_blob,'pitch');
  await page.locator('#file_input').setInputFiles(pitchFile);await click('#pitch_upload_next');await shot('Measure a pitch','Choose team and pitcher');
  await page.locator('#team_select').selectOption(String(pitch.team_id));await page.locator('#pitcher_select').selectOption(String(pitch.pitcher_id));
  await click('#pitch_upload_next');await shot('Measure a pitch','Choose pitch clip start');
  // Upload only to the isolated snapshot; the normal app performs the decoding.
  await click('#video_upload_submit');await page.waitForURL('**/upload/pitch/trim*',{timeout:120000});
  await page.locator('#pitch_step_confirm').waitFor({state:'visible',timeout:120000});
  await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0,null,{timeout:120000});
  await page.evaluate(()=>{portraitCropState={enabled:true,x:0,y:0,w:1,h:1};document.getElementById('pitch_modal_description').value='Matchup pitch example';renderPitchStep();});
  await shot('Measure a pitch','Crop pitch');await page.locator('#pitch_step_confirm').click();
  await page.evaluate(index=>{slider.value=Math.min(frames.length-1,index);updateFrameModalUI(Number(slider.value));},pitch.contact_frame);
  await shot('Measure a pitch','Mark pitch contact','The contact frame saved with the selected pitch.',{saved_pitch_contact_frame:pitch.contact_frame});
  db.prepare('UPDATE pitch_clips SET speed_export_blob=NULL,speed_export_key=NULL WHERE id=?').run(pitch.id);
  await goto('/pitch/speed?id='+pitch.id+'&sid=x&embedded=1');await shot('Measure a pitch','Pitch speed setup','Existing saved pitch in an isolated copy, with export lock removed to show the setup sequence.');
  if(await page.locator('#pv-preview').isVisible()){
   await page.locator('#pv-preview').click();await page.locator('#pv-confirm-release').waitFor({state:'visible',timeout:120000});
   await shot('Measure a pitch','Choose release frame');
   await page.locator('#pv-confirm-release').click();await media(page);await page.locator('video').first().evaluate(v=>{v.pause();});await shot('Measure a pitch','Review pitch speed and distances');
   if(only==='Tutorial finishing'||only==='Pitch sequence'||only==='Related workflows'){
    await page.locator('#pv-save').click();await page.waitForURL('**/library**',{timeout:45000});await page.waitForLoadState('domcontentloaded');
    await shot('Measure a pitch','Save and export pitch video','Save the speed measurement, then export the annotated pitch video.');
   }
  }
  await goto('/play/pitch?id='+pitch.id+'&sid=x&embedded=1');await media(page);await shot('Measure a pitch','Saved pitch playback');
 });
 await task('Swing sequence',async()=>{
  await goto('/multi-swing?sid=x&embedded=1');await shot('Tag a swing','Choose swing video and hitter');
  // An existing pending clip opens the same real trimming/tagging UI.
  const linked=requestedHit?db.prepare('SELECT pending_swing_id FROM ev_swing_links WHERE ev_hit_id=? AND swing_clip_id=? LIMIT 1').get(requestedHit,swing.id):null;
  const pending=linked?{id:linked.pending_swing_id}:db.prepare("SELECT id FROM pending_swing_clips WHERE status='pending' ORDER BY id DESC LIMIT 1").get();
  if(!pending)throw new Error('No pending swing to show the tagging workflow.');
  const pendingRow=db.prepare('SELECT clip_blob FROM pending_swing_clips WHERE id=?').get(pending.id)||{clip_blob:swing.clip_blob};
  const swingProxy=proxy(pendingRow.clip_blob,'swing');
  const changed=db.prepare('UPDATE pending_swing_clips SET clip_blob=? WHERE id=?').run(fs.readFileSync(swingProxy),pending.id);
  if(!changed.changes)db.prepare('UPDATE swing_clips SET clip_blob=? WHERE id=?').run(fs.readFileSync(swingProxy),swing.id);
  await goto('/multi-swing/pending/tag?id='+pending.id+'&sid=x&embedded=1');
  await page.locator('#swing_step_confirm').waitFor({state:'visible',timeout:120000});
  await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0,null,{timeout:120000});
  for(const [step,title] of [['crop','Crop swing'],['contact','Mark swing contact'],['commitment','Mark swing commitment'],['start','Mark swing start']]){
   const selected=step==='start'?0:step==='commitment'?swing.decision_frame:swing.frame_count-1;
   await page.evaluate(({step,index,wide})=>{swingTagStep=step;if(step==='crop'){const f=frames[0],h=.94;portraitCropState=wide?{enabled:true,x:0,y:0,w:1,h:1}:{enabled:true,x:.65,y:.03,w:(f.height*h*9/16)/f.width,h};}slider.value=Math.max(0,Math.min(frames.length-1,index));renderSwingTagStep();},{step,index:selected,wide:process.env.CAPTURE_WIDE_SWING==='1'});
   await shot('Tag a swing',title,step==='contact'?'Contact carries forward from EV; this editing screen is optional.':`Saved ${step} frame ${selected} in this swing clip.`,{saved_swing_frame:selected,saved_swing_step:step});
  }
  await goto('/play/swing?id='+swing.id+'&sid=x&embedded=1');await media(page);await shot('Tag a swing','Saved swing playback');
 });
 await task('Matchup sequence',async()=>{
  await goto('/matchup/select?pitch_id='+pitch.id+'&swing_id='+swing.id+'&sid=x&embedded=1');
  await shot('Create a matchup','Choose saved pitch');await page.locator('#matchup-next').click();
  await shot('Create a matchup','Choose saved swing');await page.locator('#matchup-next').click();
  await shot('Create a matchup','Review matchup');
  await goto('/play/matchup?id='+matchup.id+'&sid=x&embedded=1');await media(page);await shot('Create a matchup','Matchup playback and download','Existing saved matchup; no new matchup created.');
 });
 for(const [title,route] of [['Library','/library?type=ev'],['Player dashboard','/dashboard/player'],['Measurement dashboard','/dashboard/measurements'],['Teams','/teams'],['Hitters','/hitters'],['Pitchers','/pitchers'],['Import video from link','/external_video'],['Data settings','/settings/data'],['Privacy','/privacy'],['Terms','/terms']]){
  await task(title,async()=>{await goto(route+(route.includes('?')?'&':'?')+'sid=x');await shot('Supporting pages',title,'Supporting page, outside the main task sequence.');});
 }
 }finally{
  writeGallery();await browser.close();await new Promise(r=>server.close(r));db.close();closeDatabase();
 }
 console.log(JSON.stringify({output:out,count:entries.length,failures},null,2));
}
function writeGallery(){
 for(let i=entries.length-1;i>=0;i--)if(entries[i].title==='Data settings')entries.splice(i,1); // Disabled in this local app.
 const contact=entries.find(e=>e.title==='Contact on the bat');
 const saved=entries.find(e=>e.title==='EV video saved');
 if(saved)saved.note='Save-completion screen while its video loads. The next capture shows the saved video playing in the library.';
 entries.filter(e=>mapTitles.includes(e.title)).forEach(e=>{e.note='Map tiles were unavailable in this capture. Loading replacement tiles for the saved field location requires approval.';});
 if(contact)contact.note='Current layout: the lower contact controls are clipped at this viewport. This capture is retained for review.';
 const swingContact=entries.find(e=>e.title==='Mark swing contact');
 if(swingContact)swingContact.note='Optional: skipped when contact was already detected or marked during EV modeling.';
 const order=['Start','Measure a hit','Measure a pitch','Tag a swing','Create a matchup','Supporting pages','Capture problems'];
 entries.sort((a,b)=>order.indexOf(a.group)-order.indexOf(b.group)||((originalOrder.get(a.title)??1e9)-(originalOrder.get(b.title)??1e9)));
 const completion=entries.find(e=>e.title==='EV video saved');
 if(completion){entries.splice(entries.indexOf(completion),1);const playback=entries.findIndex(e=>e.title==='Saved hit playback');entries.splice(playback<0?entries.length:playback,0,completion);}
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({captured_at:new Date().toISOString(),viewport:{width:1440,height:900},entries,failures},null,2));
 const groups=[...new Set(entries.map(e=>e.group))];
 const html=fs.readFileSync(path.join(__dirname,'screen-gallery-template.html'),'utf8').replace('__SCREEN_DATA__',JSON.stringify(entries).replace(/</g,'\\u003c'));
 fs.writeFileSync(path.join(out,'index.html'),html);
}
if(only==='build-gallery'){
 writeGallery();
 fs.mkdirSync(path.join(out,'images'),{recursive:true});
 entries.forEach((entry,index)=>{
  const file='images/'+String(index+1).padStart(2,'0')+'-'+entry.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'')+'.jpg';
  if(entry.file!==file)fs.copyFileSync(path.join(out,entry.file),path.join(out,file));
  entry.file=file;
 });
 writeGallery();console.log('Ordered gallery: '+entries.length+' captures.');
}else main().catch(e=>{console.error(e);writeGallery();process.exitCode=1});
