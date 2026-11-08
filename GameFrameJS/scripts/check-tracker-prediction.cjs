const fs=require('node:fs'),path=require('node:path');
const source=path.resolve(process.argv[2]||'demo-output/line-tracker-after.json');
const packet=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'demo-output/ev-recording-1792655034486/observations.json')));
const detected=JSON.parse(fs.readFileSync(source));
const manual=packet.ball_observations.filter(row=>row.source==='HUMAN');
packet.ball_observations=[...manual,...detected.observations.filter(row=>!manual.some(anchor=>Math.abs(anchor.relative_time_s-row.relative_time_s)<1/60))]
 .sort((a,b)=>a.relative_time_s-b.relative_time_s).map((row,index)=>({...row,index:index+1}));
(async()=>{
 const response=await fetch('http://localhost:8000/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(packet)});
 if(!response.ok)throw new Error(await response.text());
 const prediction=await response.json(),base=source.replace(/\.json$/,'');
 fs.writeFileSync(base+'-observations.json',JSON.stringify(packet,null,2));
 fs.writeFileSync(base+'-prediction.json',JSON.stringify(prediction,null,2));
 const fit=prediction.direction_first_match;
 console.log(JSON.stringify({used_count:fit.used_count,acceptable:fit.acceptable,ev:fit.best?.exit_velocity_mph,
  launch:fit.best?.launch_angle_deg,spray:fit.best?.spray_angle_deg,distance:fit.best?.distance_ft,pixel_error:fit.pixel_error},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
