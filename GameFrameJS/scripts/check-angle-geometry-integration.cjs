const fs=require('node:fs'),assert=require('node:assert/strict');
const base='http://127.0.0.1:8000';
(async()=>{
 const raw=await(await fetch(base+'/api/gameframe/ev-json?id=90&kind=package')).text();
 const reports=[];
 for(const [label,packet] of [['night',JSON.parse(fs.readFileSync('demo-output/night-overlay-test-package.json'))],['day',JSON.parse(raw)]]){
  const response=await fetch(base+'/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
  if(!response.ok)throw Error(await response.text());
  const prediction=await response.json(),fit=prediction.direction_first_match,angle=prediction.launch_angle_uncertainty;
  fs.writeFileSync('demo-output/'+label+'-angle-geometry-prediction.json',JSON.stringify(prediction,null,2));
  assert.equal(fit.acceptable,true,label+' retains an accepted conditional estimate');
  assert.equal(angle.is_confidence_interval,false);
  assert.ok(angle.camera_pose_count>1,label+' propagates camera uncertainty');
  assert.ok(angle.range_deg.every(Number.isFinite));
  const range=prediction.measurement_support.launch_angle_deg;
  assert.ok(range[0]<=fit.best.launch_angle_deg&&range[1]>=fit.best.launch_angle_deg);
  assert.ok(range[0]<=angle.range_deg[0]&&range[1]>=angle.range_deg[1]);
  if(angle.poorly_constrained){assert.equal(prediction.export_readiness.confidence,'LOW');assert.ok(prediction.evidence_warnings.some(w=>w.reason==='launch_angle_geometry_sensitive'));}
  if(label==='day')assert.ok(fit.late_timing_used_count>0,'Reliable later marks still participate in timing');
  reports.push({label,acceptable:fit.acceptable,best:Object.fromEntries(['exit_velocity_mph','launch_angle_deg','distance_ft'].map(k=>[k,fit.best[k]])),angle,reported_angle_range:range,camera:prediction.resolved_geometry.calibration_diagnostics});
  console.log(JSON.stringify({label,best:reports.at(-1).best,range,sensitive:angle.poorly_constrained}));
 }
 assert.equal(await(await fetch(base+'/api/gameframe/ev-json?id=90&kind=package')).text(),raw);
 fs.writeFileSync('demo-output/angle-geometry-integration-check.json',JSON.stringify({passed:true,fresh_inference:true,inputs:'Raw measurements and source video only; no saved predictions or candidate seeds.',saved_hit_unchanged:true,reports},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
