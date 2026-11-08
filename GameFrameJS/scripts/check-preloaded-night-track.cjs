// Use only the saved contact point as detector input; flight marks stay withheld.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
(async()=>{
 const db=new Database(path.resolve('app.db'),{readonly:true}),hit=db.prepare('SELECT id,source_video_path,observation_package_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').get();db.close();
 const pkg=JSON.parse(hit.observation_package_json),contact=pkg.ball_observations.find(p=>p.role==='CONTACT_POINT'),time=pkg.hit.contact.frame_timestamp_s??pkg.hit.contact.timestamp_s;
 const fps=1/pkg.video_metadata.frame_step_assumption_s;
 const lab=require('../experiments/ball-assist/server.cjs'),server=lab.app.listen(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 const post=async(route,body)=>{const r=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 try{
  const started=performance.now(),guessed=time+3/fps;
  const prepared=await lab.prepare(hit.source_video_path,{start:guessed-10/fps,name:'Latest saved night hit',sampled:true,sourceFps:fps});
  const session=await post(`/api/session/${prepared.id}/contact`,{time});
  assert.ok(Math.abs(session.times[0]-time)<1e-5);
  const job=await post('/api/detect',{session:session.id,sampling:'dense',contact:{frame:0,x:contact.image_x*session.width/pkg.video_metadata.width_px,y:contact.image_y*session.height/pkg.video_metadata.height_px}});
  let status;
  for(let i=0;i<600;i++){
   status=await(await fetch(base+`/api/jobs/${job.id}`)).json();
   if(['done','failed','cancelled'].includes(status.state))break;
   if(i%20===0)console.log('Tracking',status.progress);
   await new Promise(r=>setTimeout(r,500));
  }
  assert.equal(status.state,'done',status.error);
  const points=status.result.points||[];assert.ok(points.length>=2,'detector must find multiple flight positions');
  assert.ok(points.some(p=>session.times[p.frame]-time>=.15));
  assert.ok(points.every(p=>Number.isInteger(session.frameNumbers[p.frame])));
  const report={hit:hit.id,simulatedSuggestionLateFrames:3,sourceContactFrame:session.frameNumbers[0],confirmedContactTime:time,preloadStart:prepared.start,preparedFrameCount:prepared.frameCount,detectedPositions:points.length,elapsedSeconds:(performance.now()-started)/1000,flightMarksWithheld:true};
  fs.mkdirSync('demo-output/selection-preload',{recursive:true});fs.writeFileSync('demo-output/selection-preload/night-track.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 }finally{lab.stopModels();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
