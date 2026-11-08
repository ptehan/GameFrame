// Exercise the real create/play/stream routes using an isolated database only.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const Database=require('better-sqlite3'),root=path.resolve(__dirname,'..');
const library=new Database(path.join(root,'app.db'),{readonly:true});
const pitch=library.prepare('SELECT * FROM pitch_clips WHERE clip_blob IS NOT NULL ORDER BY id DESC LIMIT 1').get();
const swing=library.prepare('SELECT * FROM swing_clips WHERE clip_blob IS NOT NULL ORDER BY id DESC LIMIT 1').get();library.close();
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'gf-matchup-http-'));
process.env.DB_PATH=path.join(scratch,'test.db');process.env.FFMPEG_PATH=require('ffmpeg-static');process.env.FFPROBE_PATH=require('ffprobe-static').path;
const {startServer,closeDatabase}=require('../server');
(async()=>{
 const db=new Database(process.env.DB_PATH);
 const p=db.prepare('INSERT INTO pitch_clips (clip_blob,fps,contact_frame) VALUES (?,?,?)').run(pitch.clip_blob,pitch.fps,pitch.contact_frame).lastInsertRowid;
 const s=db.prepare('INSERT INTO swing_clips (clip_blob,fps,decision_frame,frame_count,swing_seconds) VALUES (?,?,?,?,?)').run(swing.clip_blob,swing.fps,swing.decision_frame,swing.frame_count,swing.swing_seconds).lastInsertRowid;
 db.close();
 const server=startServer(0,'127.0.0.1');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port,latencies=[],probes=[];
 const timer=setInterval(()=>{const start=performance.now();probes.push(fetch(base+'/health').then(r=>{assert.equal(r.status,200);latencies.push(performance.now()-start);}));},300);
 try{
  const start=performance.now(),form=new FormData();form.set('pitch_id',String(p));form.set('swing_id',String(s));form.set('description','HTTP performance test');
  const response=await fetch(base+'/matchup/create',{method:'POST',body:form}),result=await response.json();
  const seconds=(performance.now()-start)/1000;assert.equal(response.status,200,JSON.stringify(result));assert.ok(result.id);
  clearInterval(timer);await Promise.all(probes);assert.ok(latencies.length>5,'Server must serve other HTTP requests during rendering');
  assert.ok(Math.max(...latencies)<3000,'Rendering must not block the HTTP thread');
  assert.equal((await fetch(base+'/play/matchup?id='+result.id)).status,200);
  const stream=await fetch(base+'/stream/matchup?id='+result.id,{headers:{Range:'bytes=0-1023'}});assert.equal(stream.status,206);assert.equal((await stream.arrayBuffer()).byteLength,1024);
  const report={seconds,healthRequests:latencies.length,maxHealthLatencyMs:Math.max(...latencies),meanHealthLatencyMs:latencies.reduce((a,b)=>a+b,0)/latencies.length,playback:true,rangeStreaming:true};
  const out=path.join(root,'demo-output','matchup-performance-20261105');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'http.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{clearInterval(timer);await new Promise(resolve=>server.close(resolve));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1;});
