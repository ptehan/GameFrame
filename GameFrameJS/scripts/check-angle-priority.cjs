const fs=require('node:fs'),assert=require('node:assert/strict');
const base='http://127.0.0.1:8000';
(async()=>{
 const raw=await(await fetch(base+'/api/gameframe/ev-json?id=90&kind=package')).text(),reports=[];
 for(const [label,original] of [['night',JSON.parse(fs.readFileSync('demo-output/night-overlay-test-package.json'))],['day',JSON.parse(raw)]]){
  const initial=original.hit.distance_observation.distance_ft,angles=[];
  for(const distance of [initial,initial-25,initial+25]){
   const packet=structuredClone(original);packet.hit.distance_observation.distance_ft=distance;
   const response=await fetch(base+'/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
   if(!response.ok)throw Error(await response.text());
   const prediction=await response.json(),fit=prediction.direction_first_match;
   fs.writeFileSync('demo-output/'+label+'-angle-priority-'+distance+'.json',JSON.stringify(prediction,null,2));
   assert.equal(prediction.angle_constraint_policy.mode,'calculated_angle_primary');
   assert.equal(fit.angle_primary,true);assert.equal(fit.selection_policy.distance_can_change_launch_angle,false);
   assert.ok(Math.abs(fit.selection_policy.target_distance_ft-distance)<.01,'Actually test different distance inputs');
   assert.equal(new Set(fit.candidates.map(c=>c.launch_angle_deg)).size,1);
   angles.push(fit.best.launch_angle_deg);
   const row={label,input_distance:distance,angle:fit.best.launch_angle_deg,ev:fit.best.exit_velocity_mph,modeled_distance:fit.best.distance_ft,acceptable:fit.acceptable,late_points:fit.late_timing_used_count,late_positions_used_as_height:fit.selection_policy.late_positions_used_as_height};
   reports.push(row);console.log(JSON.stringify(row));
   fs.writeFileSync('demo-output/'+label+'-angle-priority-'+distance+'.json',JSON.stringify(prediction,null,2));
  }
  assert.ok(angles.every(a=>Math.abs(a-angles[0])<1e-8),'Distance must not change '+label+' launch angle');
 }
 assert.equal(await(await fetch(base+'/api/gameframe/ev-json?id=90&kind=package')).text(),raw);
 fs.writeFileSync('demo-output/angle-priority-check.json',JSON.stringify({passed:true,fresh_inference:true,saved_hit_unchanged:true,inputs:'Raw measurements and source video; no saved predictions or candidate seeds.',reports},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
