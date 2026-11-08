// Replay only saved evidence for the latest hit. No new marks or estimates are saved.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Database=require('better-sqlite3');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const entries=[],failures=[],tileResponses=[];
let out,hit,pack;
function save(){
 if(!out)return;
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({title:`GameFrame - Hit ${hit.id}: tagged frames`,hit_id:hit.id,source_file:hit.source_file_name,created_at:hit.created_at,viewport:{width:1440,height:900},replay:'Saved marks and saved estimate; no new fit',entries,failures,tile_responses:tileResponses},null,2));
 const html=fs.readFileSync(path.join(__dirname,'screen-gallery-template.html'),'utf8').replace('__SCREEN_DATA__',JSON.stringify(entries).replace(/</g,'\\u003c'));
 fs.writeFileSync(path.join(out,'index.html'),html);
}
(async()=>{
 const original=new Database(path.join(root,'app.db'),{readonly:true});
 const requestedId=Number(process.argv[2]);
 hit=requestedId>0?original.prepare('SELECT * FROM ev_hit_tracks WHERE id=?').get(requestedId):original.prepare('SELECT * FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').get();
 if(!hit?.observation_package_json)throw new Error('Latest hit has no saved observation package.');
 pack=JSON.parse(hit.observation_package_json);
 const prediction=hit.prediction_json?JSON.parse(hit.prediction_json):null;
 out=path.join(root,'demo-output',`hit-${hit.id}-tagged-frames`);fs.mkdirSync(path.join(out,'images'),{recursive:true});
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-hit-frame-replay-'));
 process.env.DB_PATH=path.join(temp,'snapshot.db');await original.backup(process.env.DB_PATH);original.close();
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
 const page=await context.newPage();page.setDefaultTimeout(45000);
 page.on('response',r=>{if(r.url().includes('server.arcgisonline.com'))tileResponses.push({url:r.url(),status:r.status()});});
 const shot=async(group,title,note='',extra={})=>{
  const file='images/'+String(entries.length+1).padStart(2,'0')+'-'+title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'')+'.jpg';
  await page.screenshot({path:path.join(out,file),type:'jpeg',quality:92,timeout:15000,animations:'disabled'});
  entries.push({group,title,note,file,...extra});save();console.log(`CAPTURE ${entries.length}: ${title}`);
 };
 try{
  const source=pack.video_metadata?.source_path||hit.source_video_path;
  if(!fs.existsSync(source))throw new Error('Saved source video is missing: '+source);
  console.log(JSON.stringify({hit:hit.id,file:hit.source_file_name,ballTags:pack.ball_observations?.length,skipped:pack.skipped_video_marks}));
  await page.goto(base+'/?sid=x',{waitUntil:'networkidle'});
  await page.locator('[data-ev-start]').click();
  await shot('Start','Choose original video','Start with the original recording and its capture frame rate.');
  await page.locator('#ev-menu-video').setInputFiles(source);
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame')?.contentWindow?.location.pathname.includes('predictor'));
  const frame=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  await frame.waitForFunction(()=>typeof state!=='undefined'&&els.video.videoWidth>0,null,{timeout:60000});
  await frame.evaluate(async()=>{await loadGameFrameOptions();});
  await frame.evaluate(()=>{startBackgroundPrediction=()=>Promise.resolve(null);prepareClippedVideo=async()=>null;});
  await frame.locator('#actual-field-map-modal').waitFor({state:'visible'});
  const geo=pack.hit?.distance_observation?.actual_field_map||pack.camera?.actual_field_map;
  if(geo){
   await frame.evaluate(({p,g})=>{loadPackageIntoState(p);initializeActualFieldMap();actualMapResetPoints();setActualMapStage('points');actualFieldMapState.map.invalidateSize();actualFieldMapState.map.fitBounds([g.home_lat_lng,g.landing_lat_lng,g.camera_lat_lng],{padding:[80,80],maxZoom:18,animate:false});},{p:pack,g:geo});
   for(const [mode,title] of [['camera','Camera position'],['home','Home plate on map'],['axis','Second base on map'],['landing','Landing point on map']]){
    await frame.evaluate(m=>actualMapSetMode(m),mode);
    await frame.waitForFunction(()=>document.querySelectorAll('#actual-field-map .leaflet-tile-loaded').length>0,null,{timeout:30000});
    await page.waitForTimeout(1500);
    await shot('Saved field setup',title,`Hit #${hit.id}. The saved field position is replayed in its original marking sequence.`);
    await frame.evaluate(({g,m})=>actualMapPlacePoint(L.latLng(g[m+'_lat_lng'])),{g:geo,m:mode});
   }
   await frame.evaluate(()=>setActualMapStage('confirm'));
   await shot('Saved field setup','Saved landing certainty','The selected confidence and landing tolerance are the values saved with this hit.');
  }
  await frame.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());});
  const step=await frame.evaluate(p=>{loadPackageIntoState(p);return currentStep();},pack);
  const contactTime=await frame.evaluate(()=>contactCalibrationTime());
  const balls=[...(pack.ball_observations||[])].sort((a,b)=>Number(a.video_time_s)-Number(b.video_time_s));
  const events=balls.map((mark,index)=>({kind:'ball',mark,index,offset:Math.round(Number(mark.relative_time_s||0)/step),time:Number(mark.video_time_s)}));
  for(const key of pack.skipped_video_marks||[]){const match=key.match(/^flight(\d+)$/);if(match)events.push({kind:'skip',key,offset:Number(match[1]),time:contactTime+Number(match[1])*step});}
  events.sort((a,b)=>a.time-b.time);
  const settled=async time=>{
   await frame.evaluate(t=>seekVideoTo(t),time);
   await frame.waitForFunction(({time,step})=>!els.video.seeking&&els.video.readyState>=2&&Math.abs(els.video.currentTime-time)<=step*.55+.003,{time,step},{timeout:30000});
   await frame.evaluate(()=>{document.querySelectorAll('#setup-modal .marking-prompt').forEach(p=>dismissMarkingPrompt(p,true));renderOverlay();});
   await page.waitForTimeout(200);
  };
  for(const event of events){
   const prior=balls.filter(m=>Number(m.video_time_s)<event.time-step*.1);
   const priorSkips=(pack.skipped_video_marks||[]).filter(k=>{const m=k.match(/^flight(\d+)$/);return m&&Number(m[1])<event.offset;});
   await frame.evaluate(({p,prior,skips,contact})=>{
    loadPackageIntoState(p);state.observations=prior;state.landmarks=[];state.skippedVideoMarks=skips;
    goToWorkflowStep(contact?'contact':'ballPath');
   },{p:pack,prior,skips:priorSkips,contact:event.kind==='ball'&&event.offset===0});
   if(event.kind==='ball')await frame.evaluate(mark=>{state.observations.push(mark);renderObservations();renderOverlay();},event.mark);
   await settled(event.time);
   const actual=await frame.evaluate(()=>({time:els.video.currentTime,observations:state.observations.length}));
   if(event.kind==='ball'){
    const label=event.offset===0?'Contact tag':`Ball tag - ${event.offset} frames after contact`;
    const note=`${hit.source_file_name}. Saved video time ${event.time.toFixed(6)} s; +${Number(event.mark.relative_time_s||0).toFixed(6)} s from contact. Saved click: (${Number(event.mark.image_x).toFixed(2)}, ${Number(event.mark.image_y).toFixed(2)}) px.`;
    await shot('Tagged ball frames',label,note,{saved_mark:event.mark,displayed_video_time_s:actual.time});
   }else await shot('Tagged ball frames',`${event.offset} frames - tagged not visible`,`Saved skip: ${event.key}. Displayed at video time ${event.time.toFixed(6)} s. No ball position is invented.`,{saved_skip:event.key,displayed_video_time_s:actual.time});
  }
  const landmarks=pack.landmarks||[];
  for(let i=0;i<landmarks.length;i++){
   await frame.evaluate(({p,i})=>{loadPackageIntoState(p);state.landmarks=state.landmarks.slice(0,i);goToWorkflowStep('landmarks');state.landmarks.push(p.landmarks[i]);renderLandmarks();renderOverlay();},{p:pack,i});
   const time=Number(landmarks[i].calibration_time_s??contactTime);await settled(time);
   await shot('Saved field calibration',landmarks[i].landmark.replaceAll('_',' '),`Saved field tag on the contact reference at ${time.toFixed(6)} s. Click: (${Number(landmarks[i].image_x).toFixed(2)}, ${Number(landmarks[i].image_y).toFixed(2)}) px.`,{saved_landmark:landmarks[i],displayed_video_time_s:time});
  }
  if(pack.terminal_event){
   await frame.evaluate(p=>{loadPackageIntoState(p);goToWorkflowStep('ground');},pack);await settled(Number(pack.terminal_event.video_time_s));
   const groundOffset=Math.round(Number(pack.terminal_event.relative_time_s)/step);
   const groundActual=await frame.evaluate(()=>els.video.currentTime);
   await shot('Tagged ball frames',`Ground-contact tag - ${groundOffset} frames after contact`,`Saved ground-contact time ${Number(pack.terminal_event.video_time_s).toFixed(6)} s. ${pack.terminal_event.image_x===null?'No ground pixel location was marked.':''}`,{saved_terminal_event:pack.terminal_event,displayed_video_time_s:groundActual});
  }else{
   await frame.evaluate(()=>goToWorkflowStep('groundChoice'));
   await shot('Saved result','Ground-contact visibility','No ground-contact tag was saved for this hit.');
  }
  if(prediction){
   await frame.evaluate(({p,result})=>{loadPackageIntoState(p);state.latestPrediction=result;renderDirectPredictionCard(els.predictionUnconstrained,result);prepareClippedVideo=async()=>null;startBackgroundPrediction=()=>Promise.resolve(result);goToWorkflowStep('player');},{p:pack,result:prediction});
   await shot('Saved result','Saved estimate',`Existing saved estimate for hit #${hit.id}; displayed with its saved inputs.`);
  }
  await page.goto(base+`/library?type=ev&sid=x`,{waitUntil:'networkidle'});
  const card=page.locator(`#library_grid .card-row[data-type="ev"][data-id="${hit.id}"]`);await card.waitFor();await card.locator('details.library-details').evaluate(d=>d.open=true);
  const play=card.locator(`[data-ev-play="${hit.id}"]`);await play.focus();await play.click();
  await page.locator('#ev-library-player[open]').waitFor();
  await page.waitForFunction(()=>document.querySelector('#ev-library-player video')?.readyState>=2,null,{timeout:45000});
  await page.locator('#ev-library-player video').evaluate(v=>{v.pause();v.currentTime=Math.min(2,v.duration*.2);});
  await page.waitForFunction(()=>!document.querySelector('#ev-library-player video').seeking);
  await shot('Saved result','Saved video playback',`The existing saved video for hit #${hit.id}.`);
 }catch(error){failures.push(error.message);save();throw error;}
 finally{save();await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
 console.log(JSON.stringify({hit:hit.id,folder:out,captures:entries.length,failures}));
})().catch(error=>{console.error(error);save();process.exitCode=1});
