// Controlled diagnostic only: do not change app settings or saved library data.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'demo-output/ev-recording-1792655034486/observations.json');
const directory=path.join(root,'demo-output',process.argv[2]||'manual-anchor-check');fs.mkdirSync(directory,{recursive:true});
const packet=JSON.parse(fs.readFileSync(source));
const originalCount=packet.ball_observations.length;
if(process.argv[3]!=='all'){
 packet.ball_observations=packet.ball_observations.filter(p=>p.source==='HUMAN');
 if(packet.ball_observations.length!==2)throw new Error('Expected contact and one manual flight anchor.');
}
const input=path.join(directory,'manual-observations.json'),output=path.join(directory,'prediction.json');
fs.writeFileSync(input,JSON.stringify(packet,null,2));
console.log('Testing point selection; original points '+originalCount+', retained '+packet.ball_observations.length);
const result=spawnSync(path.join(root,'.venv-ev/Scripts/python.exe'),['-B','synthetic/direct_video_estimate.py',input,'--db','data/hittrax_from_video.sqlite','--out',output],{cwd:path.join(root,'ev-predictor'),encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(directory,'stdout.txt'),result.stdout||'');fs.writeFileSync(path.join(directory,'stderr.txt'),result.stderr||'');
if(result.status!==0)throw new Error(result.error?.message||result.stderr||'Estimator failed');
const prediction=JSON.parse(fs.readFileSync(output));
const fit=prediction.direction_first_match;
const summary={originalCount,used:fit?.used_count,acceptable:fit?.acceptable,best:fit?.best,pixel_error:fit?.pixel_error,readiness:prediction.export_readiness};
fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({used:summary.used,acceptable:summary.acceptable,ev:fit?.best?.exit_velocity_mph,launch:fit?.best?.launch_angle_deg,distance:fit?.best?.distance_ft,error:fit?.pixel_error?.rmse_px}));
