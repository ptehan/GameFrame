const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'demo-output/ball-assist-lab');
(async()=>{
 const form=new FormData();form.append('video',new Blob([fs.readFileSync(path.join(OUT,'timing-60fps.mp4'))],{type:'video/mp4'}),'timing-60fps.mp4');form.append('start','0.333333');
 const response=await fetch('http://127.0.0.1:8017/api/session',{method:'POST',body:form}),session=await response.json();if(!response.ok)throw Error(session.error);
 assert.ok(Math.abs(session.fps-60)<.001);assert.equal(session.frameCount,100);assert.ok(Math.abs(session.times[0]-1/3)<.000002);
 for(let i=1;i<session.times.length;i++)assert.ok(Math.abs(session.times[i]-session.times[i-1]-1/60)<.000002);
 const invalid=await fetch(`http://127.0.0.1:8017/api/session/${session.id}/frame/100`);assert.equal(invalid.status,404);
 const result={passed:true,fps:session.fps,frames:session.frameCount,first_time:session.times[0],last_time:session.times.at(-1),native_timestamps:true};
 fs.writeFileSync(path.join(OUT,'frame-rate-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;});
