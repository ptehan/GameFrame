// Fresh inference from raw images + contact. Prior outputs are not detector inputs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../demo-output/ball-assist-lab'),base='http://127.0.0.1:8000/api/ball-assist';
async function request(url,options){const r=await fetch(base+url,options),d=await r.json();if(!r.ok)throw Error(JSON.stringify(d));return d;}
(async()=>{
 const reports=[];
 for(const [label,id] of [['night','68f594a7-3a2e-492e-9541-90d4d1c6f931'],['day','cf445e07-6b8a-4496-9513-836a338aba3f']]){
  const folder=path.join(root,id),session=JSON.parse(fs.readFileSync(path.join(folder,'session.json')));
  const inputFile=fs.readdirSync(folder).find(n=>n.endsWith('-contact-input.json'));
  const contact=JSON.parse(fs.readFileSync(path.join(folder,inputFile))).contact;
  const job=await request('/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:id,contact,sampling:'dense'})});
  let result;
  const deadline=Date.now()+300000;
  while(Date.now()<deadline){
   await new Promise(r=>setTimeout(r,600));const status=await request('/jobs/'+job.id);
   if(status.state==='done'){result=status.result;break;}
   if(['failed','cancelled'].includes(status.state))throw Error(status.error||status.state);
  }
  assert.ok(result,'Detection timed out');
  const report={label,session,job:job.id,model_fingerprint:job.model_fingerprint,result};
  fs.writeFileSync(path.join(root,'background-rejection-'+label+'.json'),JSON.stringify(report,null,2));
  assert.equal(result.last_scanned_frame,59,'Keep scanning after losses');
  if(label==='night'){
   for(const point of result.points)assert.ok(![[33,290,240],[35,302,249],[36,311,260]].some(([frame,x,y])=>point.frame===frame&&Math.hypot(point.x-x,point.y-y)<10),'Reject the visually checked on-deck helmet');
   assert.ok(result.points.length>=4,'Retain verified launch');
   const old=JSON.parse(fs.readFileSync(path.join(folder,'721b9540-efd8-45e0-88a7-1fdfc25fa7e0-contact-result.json')));
   for(const point of result.points)assert.ok(!old.points.some(p=>p.frame>=14&&p.frame===point.frame&&Math.hypot(p.x-point.x,p.y-point.y)<8),'Reject the observed light/background position');
   for(const [frame,x,y] of [[6,484,95],[7,456,75],[8,398,31]]){
    const point=result.points.find(p=>p.frame===frame);
    assert.ok(point,'Recover the visible ball in frame '+frame);
    assert.ok(Math.hypot(point.x-x,point.y-y)<12,'Recovered point follows visible ball, not a net strand');
   }
  }else{
   for(const [time,x,y] of [[3.666629,346.82,11.74],[3.999959,331.82,48.56]]){
    const point=result.points.find(p=>Math.abs(session.times[p.frame]-time)<.015);
    assert.ok(point,'Retain actual later ball sighting '+time);
    assert.ok(Math.hypot(point.x-x,point.y-y)<6,'Later mark agrees with held-out human point');
   }
  }
  reports.push({label,points:result.points.length,last_checked:session.times[result.last_scanned_frame],last_observation:session.times[result.points.at(-1).frame]});
  console.log(JSON.stringify(reports.at(-1)));
 }
 fs.writeFileSync(path.join(root,'background-rejection-check.json'),JSON.stringify({passed:true,fresh_inference:true,uses_later_manual_seeds:false,reports},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
