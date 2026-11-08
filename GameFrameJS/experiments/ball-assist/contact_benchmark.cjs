const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const out=path.resolve(__dirname,'../../demo-output/ball-assist-lab'),base='http://127.0.0.1:8017';
const refs=JSON.parse(fs.readFileSync(path.join(out,process.env.CONTACT_REFERENCE||'references.json'))),decoded=JSON.parse(fs.readFileSync(path.join(out,process.env.CONTACT_ALIGNMENT||'reference-frame-times.json'))).rows;
async function request(url,options){const r=await fetch(base+url,options),j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j;}
(async()=>{const rows=[],previous=process.env.CONTACT_REUSE==='1'?JSON.parse(fs.readFileSync(path.join(out,'contact-benchmark.json'))):null;let frozenFingerprint=null;for(const ref of refs){
 const form=new FormData();form.append('example',ref.example);form.append('mode','contact');
 const prior=previous?.rows.find(r=>r.hit_id===ref.hit_id),rawSession=process.env.CONTACT_SESSION||prior?.session;if(process.env.CONTACT_SESSION&&refs.length!==1)throw Error('A raw session can only be reused for a single recording');const s=rawSession?JSON.parse(fs.readFileSync(path.join(out,rawSession,'session.json'))):await request('/api/session',{method:'POST',body:form});s.frameCount??=s.times.length;
 const convert=p=>{const target=decoded.find(r=>r.hit_id===ref.hit_id&&Math.abs(r.requested_time_s-p.time_s)<1e-7)?.displayed_time_s??p.time_s;const nearest=t=>s.times.reduce((best,v,i)=>Math.abs(v-t)<Math.abs(s.times[best]-t)?i:best,0);return {frame:nearest(target),nominal_frame:nearest(p.time_s),x:p.x*s.width/ref.width,y:p.y*s.height/ref.height};};
 const contact=convert(ref.manual_points.find(p=>p.relative_s===0));delete contact.nominal_frame;
 const started=Date.now(),job=await request('/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:s.id,contact,sampling:process.env.CONTACT_SAMPLING||'dense'})});
 if(!job.model_fingerprint)throw Error('This server does not freeze detector code per run. Restart the lab before testing.');
 if(frozenFingerprint&&job.model_fingerprint!==frozenFingerprint)throw Error('Detector changed between recordings; discard this evaluation.');frozenFingerprint=job.model_fingerprint;
 console.log(JSON.stringify({hit_id:ref.hit_id,job:job.id,session:s.id,phase:'scanning'}));
 let state;do{await new Promise(r=>setTimeout(r,700));state=await request('/api/jobs/'+job.id);}while(state.state==='running');
 if(state.state!=='done')throw Error(state.error||state.state);
 if(state.result.scanned_frames!==s.frameCount-contact.frame-1)throw Error('Full suffix was not scanned');
 if(state.result.uses_ev_prediction||state.result.uses_later_manual_seeds)throw Error('Evaluation inputs were contaminated');
 const found=new Map(state.result.points.map(p=>[p.frame,p]));
 const checked=new Set(state.result.sampling?.detection_frames||[]);
 const held=ref.manual_points.filter(p=>p.relative_s>0).map(p=>{const q=convert(p),v=found.get(q.frame),n=found.get(q.nominal_frame);return {...q,time_s:p.time_s,checked:checked.has(q.frame),proposed:!!v,error_source_px:v?Math.hypot(v.x-q.x,v.y-q.y)*ref.width/s.width:null,nominal_error_px:n?Math.hypot(n.x-q.x,n.y-q.y)*ref.width/s.width:null};});
 const row={hit_id:ref.hit_id,session:s.id,job:job.id,model_fingerprint:frozenFingerprint,contact,elapsed_s:(Date.now()-started)/1000,frame_count:s.frameCount,scanned:state.result.scanned_frames,expected:s.frameCount-contact.frame-1,proposed:found.size,held_out:held,sampling:state.result.sampling,ground_review:state.result.ground_review,flight_reference_check_passed:held.every(p=>p.proposed&&p.error_source_px<=6)};rows.push(row);console.log(JSON.stringify({...row,sampling:row.sampling?{...row.sampling,detection_frames:undefined}:null}));
 fs.writeFileSync(path.join(out,process.env.CONTACT_REPORT||'contact-benchmark.json'),JSON.stringify({input:'Contact only; every later manual point held out. No EV predictions or saved candidates. Frozen detector files execute in a separate process.',scope:`${refs.length} development recording(s); not independent validation.`,tested_at:new Date().toISOString(),model_manifest:state.model_manifest,detector_sha256:state.model_manifest.files['contact_scan.py'],rows},null,2));
 }})().catch(e=>{console.error(e);process.exitCode=1;});
