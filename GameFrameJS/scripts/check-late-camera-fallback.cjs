const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const packet=JSON.parse(fs.readFileSync('demo-output/night-overlay-test-package.json'));
 const original=await(await fetch('http://127.0.0.1:8000/api/gameframe/ev-json?id=73&kind=package')).text();
 const before=JSON.parse(fs.readFileSync('demo-output/night-overlay-fresh-prediction.json'));
 packet.camera={...packet.camera,changed_during_ball_marks:true};
 packet.ball_observations.push({index:10,relative_time_s:100,video_time_s:102,image_x:10000,image_y:-9000,source:'HUMAN',confidence:'MEDIUM',uncertainty_px:6});
 const response=await fetch('http://127.0.0.1:8000/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
 if(!response.ok)throw Error(await response.text());
 const after=await response.json();
 assert.equal(after.direction_first_match.acceptable,true,'Uncorrectable late marks and camera-moved flag cannot reject supported early fit');
 assert.equal(after.camera_motion.excluded_late_points.length,1);
 for(const key of ['exit_velocity_mph','launch_angle_deg','distance_ft'])assert.ok(Math.abs(before.direction_first_match.best[key]-after.direction_first_match.best[key])<1e-6,key+' must retain early fit');
 assert.ok(after.evidence_warnings.some(w=>w.reason==='late_camera_alignment_uncertain'));
 assert.equal(await(await fetch('http://127.0.0.1:8000/api/gameframe/ev-json?id=73&kind=package')).text(),original);
 fs.writeFileSync('demo-output/late-camera-fallback-check.json',JSON.stringify({passed:true,fresh_inference:true,saved_hit_unchanged:true,best:after.direction_first_match.best,excluded:after.camera_motion.excluded_late_points},null,2));
 console.log('PASS: uncertain later evidence excluded, early fit unchanged, camera-moved flag does not reject it, saved hit unchanged.');
})().catch(e=>{console.error(e);process.exitCode=1;});
