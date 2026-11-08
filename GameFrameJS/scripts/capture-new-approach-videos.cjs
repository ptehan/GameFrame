// Tutorial captures use the latest saved example and an isolated database copy.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const Database=require('better-sqlite3'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'demo-output/gameframe-20261106'),assets=path.join(out,'assets'),shots=path.join(out,'screens');
for(const dir of [out,assets,shots])fs.mkdirSync(dir,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
function media(name,blob){const file=path.join(assets,name+'.mp4');fs.writeFileSync(file,blob);const r=spawnSync(ffprobe,['-v','error','-show_format','-show_streams','-of','json',file],{encoding:'utf8',windowsHide:true});if(r.status)throw Error(r.stderr);const p=JSON.parse(r.stdout);return{path:file,sha256:sha(file),duration_s:Number(p.format.duration),width:p.streams.find(s=>s.codec_type==='video').width,height:p.streams.find(s=>s.codec_type==='video').height};}
(async()=>{
 const original=new Database(path.join(root,'app.db'),{readonly:true});
 const hit=original.prepare('SELECT * FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').get();
 const link=original.prepare('SELECT * FROM ev_swing_links WHERE ev_hit_id=?').get(hit.id);
 const matchup=original.prepare('SELECT * FROM matchups WHERE swing_clip_id=? ORDER BY id DESC LIMIT 1').get(link.swing_clip_id);
 const swing=original.prepare('SELECT * FROM swing_clips WHERE id=?').get(link.swing_clip_id),pitch=original.prepare('SELECT * FROM pitch_clips WHERE id=?').get(matchup.pitch_clip_id);
 const previousSession=fs.existsSync(path.join(out,'session.json'))?JSON.parse(fs.readFileSync(path.join(out,'session.json'))):null;
 let pitchExport=pitch.speed_export_blob;
 if(!pitchExport&&previousSession?.pitch_id===pitch.id&&previousSession.sources.pitch.sha256===crypto.createHash('sha256').update(pitch.clip_blob).digest('hex')&&fs.existsSync(previousSession.existing.pitch?.path||''))pitchExport=fs.readFileSync(previousSession.existing.pitch.path);
 if(!hit.generated_clip_blob||!matchup?.matchup_blob)throw Error('Saved example needs finished EV and matchup.');
 const session={hit_id:hit.id,pitch_id:pitch.id,swing_id:swing.id,matchup_id:matchup.id,pending_swing_id:link.pending_swing_id,source_path:hit.source_video_path,source_file:hit.source_file_name,pack:JSON.parse(hit.observation_package_json),prediction:JSON.parse(hit.prediction_json),swing:{fps:swing.fps,frame_count:swing.frame_count,decision_frame:swing.decision_frame,swing_seconds:swing.swing_seconds,commitment_ms:1000*(swing.frame_count-1-swing.decision_frame)/swing.fps},pitch:{fps:pitch.fps,contact_frame:pitch.contact_frame,release_frame:pitch.release_frame,initial_mph:pitch.initial_mph,average_mph:pitch.average_mph},existing:{ev:media('saved-ev',hit.generated_clip_blob),pitch:pitchExport?media('saved-pitch-speed',pitchExport):null,matchup:media('saved-matchup',matchup.matchup_blob)},sources:{pitch:media('pitch-source',pitch.clip_blob),swing:media('swing-source',swing.clip_blob)}};
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-video-refresh-'));process.env.DB_PATH=path.join(temp,'snapshot.db');await original.backup(process.env.DB_PATH);original.close();
 fs.writeFileSync(path.join(out,'session.json'),JSON.stringify(session,null,2));
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 if(!session.existing.pitch){const response=await fetch(base+'/export/pitch-speed?id='+pitch.id);if(!response.ok)throw Error(await response.text());session.existing.pitch=media('saved-pitch-speed',Buffer.from(await response.arrayBuffer()));fs.writeFileSync(path.join(out,'session.json'),JSON.stringify(session,null,2));}
 const browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1280,height:720},serviceWorkers:'block'});page.setDefaultTimeout(90000);
 const previous=process.env.CAPTURE_ONLY&&fs.existsSync(path.join(out,'captures.json'))?JSON.parse(fs.readFileSync(path.join(out,'captures.json'))):null;
 const manifest={example:{hit:hit.id,pitch:pitch.id,swing:swing.id,matchup:matchup.id},basis:'Real saved media; current UI with saved evidence replayed for illustration. No production database writes or accuracy test claims.',entries:previous?.entries||[],failures:[]};
 const shot=async name=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const file=path.join(shots,name+'.png');await page.screenshot({path:file,animations:'disabled'});manifest.entries.push({name,file,url:page.url()});fs.writeFileSync(path.join(out,'captures.json'),JSON.stringify(manifest,null,2));console.log('CAPTURE '+name);};
 const go=async url=>{await page.goto(base+url,{waitUntil:'domcontentloaded'});};
 const task=async(name,fn)=>{if(process.env.CAPTURE_ONLY&&process.env.CAPTURE_ONLY!==name)return;try{console.log('START '+name);await fn();}catch(e){manifest.failures.push({name,error:e.message});console.error('FAILED '+name+': '+e.message);await shot('failure-'+name).catch(()=>{});}};
 try{
 await task('home',async()=>{await go('/');await shot('home');});
 await task('ev',async()=>{
  await go('/ev/predictor.html');await page.waitForFunction(()=>typeof loadVideoFile==='function'&&els.gameframeTeam.options.length>1,null,{timeout:180000});
  await page.locator('#video-file').setInputFiles(session.source_path);await page.locator('#ev-people-modal').waitFor({state:'visible'});await shot('choose-hitter');
  await page.locator('#gameframe-team').selectOption(String(hit.team_id));await page.locator('#gameframe-hitter').selectOption(String(hit.hitter_id));await page.locator('#actual-field-map-modal').waitFor({state:'visible'});await shot('field-address');
  await page.evaluate(p=>{
   loadPackageIntoState(p);initializeActualFieldMap();actualMapResetPoints();setActualMapStage('points');
   const g=p.hit.distance_observation.actual_field_map;actualFieldMapState.map.fitBounds([g.camera_lat_lng,g.home_lat_lng,g.landing_lat_lng],{padding:[60,60],maxZoom:18,animate:false});
   for(const [mode,key] of [['camera','camera_lat_lng'],['home','home_lat_lng'],['axis','axis_lat_lng'],['landing','landing_lat_lng']]){actualMapSetMode(mode);actualMapPlacePoint(L.latLng(g[key]));}
  },session.pack);
  await page.waitForTimeout(2500);await shot('map-landing');
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());goToWorkflowStep('contact');els.video.currentTime=contactCalibrationTime();});
  await page.waitForFunction(()=>els.video.readyState>=2&&!els.video.seeking);await shot('contact');
  // Re-present the actual reviewed CV marks from this saved measurement. They
  // are not supplied to a detector or passed off as an independent test.
  await page.evaluate(p=>{
   stopNativeBallAssist();nativeBallAssist.phase='review';nativeBallAssist.points=p.ball_observations.filter(o=>o.role!=='CONTACT_POINT'&&o.relative_time_s>0&&o.source==='COMPUTER_VISION');
   nativeBallAssist.contactPicture=null;state.autoObservations=nativeBallAssist.points;goToWorkflowStep('ballPath');renderOverlay();
  },session.pack);await shot('automatic-review');
  await page.evaluate(()=>useRegularIntervalTagging());await page.waitForFunction(()=>!els.video.seeking);await shot('manual-fallback');
  await page.evaluate(p=>{loadPackageIntoState(p);state.pendingLandmarks=state.landmarks.map(x=>({...x}));state.landmarks=[];nativeBallAssist.phase='accepted';state.ballAssistAccepted=true;state.detectionAccepted=true;renderWorkflowStep('landmarks');els.video.currentTime=contactCalibrationTime();},session.pack);
  await page.waitForFunction(()=>!els.video.seeking);await shot('field-marks');
  await page.evaluate(()=>goToWorkflowStep('groundChoice'));await shot('ground-choice');
  await page.evaluate(({p,result})=>{loadPackageIntoState(p);state.latestPrediction=result;renderDirectPredictionCard(els.predictionUnconstrained,result);goToWorkflowStep('player');},{p:session.pack,result:session.prediction});
  await page.waitForFunction(()=>activeWorkflowStep==='player'&&state.latestPrediction);await shot('estimate');
 });
 await task('timing',async()=>{
  await go('/multi-swing/pending/tag?id='+link.pending_swing_id+'&embedded=1');await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0,null,{timeout:180000});
  for(const [step,index,name] of [['crop',0,'swing-crop'],['contact',swing.frame_count-1,'swing-contact'],['commitment',swing.decision_frame,'swing-commitment'],['start',0,'swing-first-move']]){
   await page.evaluate(({step,index})=>{swingTagStep=step;slider.value=index;if(step==='crop')portraitCropState={enabled:true,x:0,y:0,w:1,h:1};renderSwingTagStep();},{step,index});await shot(name);
  }
  await go('/play/swing?id='+swing.id+'&embedded=1');await page.locator('video').first().waitFor();await shot('saved-swing');
 });
 await task('pitch',async()=>{
  await go('/upload/pitch?embedded=1');await shot('pitch-upload');
  const tempId=crypto.randomUUID();fs.writeFileSync(path.join(os.tmpdir(),'gf_'+tempId+'.mp4'),pitch.clip_blob);
  await go('/upload/pitch/trim?embedded=1&temp_id='+tempId+'&team_id='+pitch.team_id+'&pitcher_id='+pitch.pitcher_id);
  await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0,null,{timeout:180000});
  await page.evaluate(()=>{portraitCropState={enabled:true,x:0,y:0,w:1,h:1};renderPitchStep();});await shot('pitch-crop');
  await page.locator('#pitch_step_confirm').click();
  await page.evaluate(index=>{slider.value=index;updateFrameModalUI(index);},pitch.contact_frame);await shot('pitch-contact');
  const uiDb=new Database(process.env.DB_PATH);uiDb.prepare('UPDATE pitch_clips SET speed_export_blob=NULL,speed_export_key=NULL WHERE id=?').run(pitch.id);uiDb.close();
  await go('/pitch/speed?id='+pitch.id+'&embedded=1');await page.waitForTimeout(1500);await shot('pitch-speed');
  const preview=page.locator('#pv-preview');
  if(await preview.isVisible()){await preview.click();await page.locator('#pv-confirm-release').waitFor({state:'visible',timeout:120000});await shot('pitch-release');}
  await go('/play/pitch?id='+pitch.id+'&embedded=1');await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,null,{timeout:60000});await shot('pitch-playback');
 });
 await task('matchup',async()=>{
  await go('/matchup/select?embedded=1');await page.selectOption('#pitch_clip',String(pitch.id));await shot('matchup-pitch');await page.locator('#matchup-next').click();await page.selectOption('#swing_clip',String(swing.id));await shot('matchup-swing');await page.locator('#matchup-next').click();await shot('matchup-review');
  await go('/play/matchup?id='+matchup.id+'&embedded=1');await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2,null,{timeout:60000});await shot('matchup-playback');
 });
 await task('dashboard',async()=>{await go('/dashboard/player?hid='+swing.hitter_id+'&tid='+swing.team_id);await shot('dashboard');});
 await task('background',async()=>{
  await go('/multi-swing/pending/tag?id='+link.pending_swing_id+'&embedded=1');await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0,null,{timeout:180000});
  await page.evaluate(index=>{swingTagStep='commitment';slider.value=index;renderSwingTagStep();},swing.decision_frame);
  const uiDb=new Database(process.env.DB_PATH);uiDb.prepare("UPDATE ev_hit_tracks SET generated_clip_blob=NULL,generated_clip_path=NULL,video_render_status='error',video_render_error='Tutorial render in isolated copy' WHERE id=?").run(hit.id);uiDb.close();
  const retry=await fetch(base+'/api/gameframe/retry-ev-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:hit.id})});if(!retry.ok)throw Error(await retry.text());
  const status=await retry.json();await page.evaluate(({id,status})=>GameFrameEvVideoNotifications.track(id,status),{id:hit.id,status:status.status});await shot('video-preparing');
  await page.locator('#ev-video-background-notice a').waitFor({state:'visible',timeout:240000});await shot('video-ready');
 });
 }finally{fs.writeFileSync(path.join(out,'captures.json'),JSON.stringify(manifest,null,2));await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
 console.log(JSON.stringify({out,example:manifest.example,captures:manifest.entries.length,failures:manifest.failures}));
})().catch(e=>{console.error(e);process.exitCode=1;});
