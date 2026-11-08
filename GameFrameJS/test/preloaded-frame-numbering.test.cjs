const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
const lab=require('../experiments/ball-assist/server.cjs');
test('preloaded raw frames keep source numbering and re-anchor at confirmed contact at 30/60 FPS',{timeout:120000},async()=>{
 const server=lab.app.listen(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const base=`http://127.0.0.1:${server.address().port}`,temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gf-numbered-frames-'));
 try{
  for(const fps of [30,60]){
   const source=path.join(temporary,`video-${fps}.mp4`);
   const result=spawnSync(require('ffmpeg-static'),['-y','-v','error','-f','lavfi','-i',`testsrc2=s=128x96:r=${fps}`,'-t','4','-c:v','libx264','-pix_fmt','yuv420p',source]);assert.equal(result.status,0,result.stderr?.toString());
   const start=1.5-10/fps;
   const session=await lab.prepare(source,{start,name:`${fps}fps`,sampled:true,sourceFps:fps});
   assert.equal(session.frameNumbers[0],Math.ceil(start*fps-1e-5));
   assert.equal(session.frameNumbers.length,session.times.length);
   session.times.forEach((time,i)=>assert.ok(Math.abs(time-session.frameNumbers[i]/fps)<1e-5));
   const response=await fetch(base+`/api/session/${session.id}/contact`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:1.5})});
   assert.equal(response.status,200);const view=await response.json();
   assert.equal(view.frameNumbers[0],1.5*fps);assert.ok(Math.abs(view.times[0]-1.5)<1e-5);
   assert.ok(view.launchFrameCount>fps*.2);
   const outside=await fetch(base+`/api/session/${session.id}/contact`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({time:3})});assert.equal(outside.status,409);
   const form=new FormData();form.append('session',session.id);form.append('sampled','1');form.append('source_fps',String(fps));form.append('start','3');
   lab.sessions.delete(session.id); // Source metadata can be restored after a worker restart.
   const rebuilt=await fetch(base+'/api/session',{method:'POST',body:form});assert.equal(rebuilt.status,200);const replacement=await rebuilt.json();assert.equal(replacement.frameNumbers[0],3*fps);
  }
 }finally{lab.stopModels();await new Promise(r=>server.close(r));}
});
