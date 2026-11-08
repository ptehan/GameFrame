const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'demo-output/ball-assist-lab'),base=process.env.BALL_LAB_URL||'http://127.0.0.1:8017';
const references=JSON.parse(fs.readFileSync(path.join(OUT,'references.json')));
const decodedFrames=fs.existsSync(path.join(OUT,'reference-frame-times.json'))?JSON.parse(fs.readFileSync(path.join(OUT,'reference-frame-times.json'))).rows:[];
async function request(url,options){const r=await fetch(base+url,options);const j=await r.json();if(!r.ok)throw Error(j.error||String(r.status));return j;}
(async()=>{
 const rows=[];
 const previous=process.env.BALL_LAB_REUSE==='1'?JSON.parse(fs.readFileSync(path.join(OUT,'benchmark.json'))):null;
 for(const ref of references){
  const prior=previous?.rows.find(r=>r.hit_id===ref.hit_id);
  let s;
  if(prior)s=JSON.parse(fs.readFileSync(path.join(OUT,prior.session,'session.json')));
  else{const form=new FormData();form.append('example',ref.example);s=await request('/api/session',{method:'POST',body:form});}
  const visible=ref.manual_points.filter(p=>p.relative_s>0).sort((a,b)=>a.time_s-b.time_s);
  const convert=p=>{const decoded=decodedFrames.find(r=>r.hit_id===ref.hit_id&&Math.abs(r.requested_time_s-p.time_s)<1e-7),target=decoded?.displayed_time_s??p.time_s;let frame=0,nominal=0;s.times.forEach((t,i)=>{if(Math.abs(t-target)<Math.abs(s.times[frame]-target))frame=i;if(Math.abs(t-p.time_s)<Math.abs(s.times[nominal]-p.time_s))nominal=i;});return {frame,nominal_frame:nominal,displayed_time_s:target,x:p.x*s.width/ref.width,y:p.y*s.height/ref.height};};
  const anchors=visible.slice(0,2).map(convert),held=visible.slice(2).map(p=>({...convert(p),time_s:p.time_s}));
  const start=Date.now();const job=await request('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:s.id,anchors:anchors.map(a=>({frame:a.frame,x:a.x,y:a.y}))})});
  let state;do{await new Promise(r=>setTimeout(r,300));state=await request('/api/jobs/'+job.id);}while(state.state==='running');
  if(state.state!=='done')throw Error(state.error);const byFrame=new Map(state.result.points.map(p=>[p.frame,p]));
  const windowEnd=anchors.at(-1).frame+Math.min(60,Math.round(s.fps*.9));
  const checks=held.map(p=>{const suggested=byFrame.get(p.frame),nominal=byFrame.get(p.nominal_frame);return {frame:p.frame,nominal_frame:p.nominal_frame,time_s:p.time_s,displayed_time_s:p.displayed_time_s,in_batch:p.frame<=windowEnd,proposed:!!suggested,error_source_px:suggested?Math.hypot(suggested.x-p.x,suggested.y-p.y)*ref.width/s.width:null,error_at_nominal_time_px:nominal?Math.hypot(nominal.x-p.x,nominal.y-p.y)*ref.width/s.width:null,manual:[p.x,p.y],suggested:suggested?[suggested.x,suggested.y]:null};});
  const row={hit_id:ref.hit_id,session:s.id,seed_frames:anchors.map(a=>a.frame),seed_count:anchors.length,proposed_frames:state.result.points.length,elapsed_s:(Date.now()-start)/1000,stop:state.result.stopped,held_out:checks};rows.push(row);console.log(JSON.stringify(row));
 }
 const tested=rows.flatMap(r=>r.held_out).filter(r=>r.in_batch),proposed=tested.filter(r=>r.proposed);
 const report={method:'Fresh image tracking; two manual seed points only. All other manual points are held out. No saved EV fits, candidates, or predicted trajectories are inputs. Decoded raw frames may be reused.',reference_alignment:'Reference image times measured independently with Chrome requestVideoFrameCallback at the original saved seek time; labels are not moved to fit tracker coordinates. Nominal-time error is also retained.',evaluation_scope:'Small development check, not independent general accuracy validation.',recordings:rows.length,held_out_in_batches:tested.length,proposed_at_held_out_frames:proposed.length,within_6_source_pixels:proposed.filter(r=>r.error_source_px<=6).length,needs_correction:proposed.filter(r=>r.error_source_px>6).length,abstained:tested.length-proposed.length,rows};
 fs.writeFileSync(path.join(OUT,'benchmark.json'),JSON.stringify(report,null,2));console.log('REPORT '+JSON.stringify({...report,rows:undefined}));
})().catch(e=>{console.error(e);process.exitCode=1;});
