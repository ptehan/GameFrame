const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {app,prepare,STORE,stopModels}=require('./server.cjs');
(async()=>{
 const reference=JSON.parse(fs.readFileSync(path.join(STORE,'selected-reference.json')))[0],contact=reference.manual_points.find(p=>p.relative_s===0),started=Date.now();
 const session=await prepare(reference.video,{start:contact.time_s,contact:contact.time_s,name:'Cortland sampled scan',full:true,sampled:true,sourceFps:30.05048600897468});
 const preparationSeconds=(Date.now()-started)/1000;
 assert.ok(session.frameCount<=60);assert.ok(session.duration<=10);assert.ok(session.width<=1280);assert.ok(session.frameStride>=5);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));}),base='http://127.0.0.1:'+server.address().port;
 try{
  const detectStart=Date.now();const job=await(await fetch(base+'/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:session.id,sampling:'dense',contact:{frame:0,x:contact.x*session.width/reference.width,y:contact.y*session.height/reference.height}})})).json();
  let result;for(;;){result=await(await fetch(base+'/api/jobs/'+job.id)).json();if(result.state!=='running')break;await new Promise(r=>setTimeout(r,250));}
  assert.equal(result.state,'done',result.error);
  const repeated=await(await fetch(base+'/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:session.id,sampling:'dense',contact:{frame:0,x:contact.x*session.width/reference.width,y:contact.y*session.height/reference.height}})})).json();
  let repeat;for(;;){repeat=await(await fetch(base+'/api/jobs/'+repeated.id)).json();if(repeat.state!=='running')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(repeat.state,'done',repeat.error);assert.deepEqual(repeat.result.points,result.result.points);
  const cancelling=await(await fetch(base+'/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:session.id,sampling:'dense',contact:{frame:0,x:contact.x*session.width/reference.width,y:contact.y*session.height/reference.height}})})).json();
  const cancelled=await(await fetch(base+'/api/jobs/'+cancelling.id,{method:'DELETE'})).json();assert.equal(cancelled.state,'cancelled');

  const checks=reference.manual_points.filter(p=>p.relative_s>0).map(label=>{const frame=session.times.reduce((best,t,i)=>Math.abs(t-label.time_s)<Math.abs(session.times[best]-label.time_s)?i:best,0),point=result.result.points.find(p=>p.frame===frame);return {time_s:label.time_s,found:!!point,error_px:point?Math.hypot(point.x*reference.width/session.width-label.x,point.y*reference.height/session.height-label.y):null};});
  const report={checks,last_time_s:session.times[result.result.points.at(-1)?.frame]??null,width:session.width,session:session.id,job:job.id,model_fingerprint:result.result.model_fingerprint,source_fps:session.sourceFps,frame_stride:session.frameStride,frame_count:session.frameCount,duration_s:session.duration,preparation_s:preparationSeconds,two_fresh_detection_runs_s:(Date.now()-detectStart)/1000,warm_repeat_identical:true,proposals:result.result.points.length,points:result.result.points,accuracy_claim:false};
  fs.writeFileSync(path.join(STORE,'sampled-scan-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,points:undefined}));
 }finally{await new Promise(resolve=>server.close(resolve));stopModels();process.exitCode=0;}
})().catch(e=>{console.error(e);process.exitCode=1;});
