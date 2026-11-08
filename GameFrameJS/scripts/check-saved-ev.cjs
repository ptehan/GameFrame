// Re-evaluate a saved observation package without modifying the library.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),id=Number(process.argv[2]);
if(!Number.isInteger(id)||id<1)throw new Error('Pass a saved EV ID.');
const db=new(require('better-sqlite3'))(path.join(root,'app.db'),{readonly:true});
const row=db.prepare('SELECT id,description,observation_package_json FROM ev_hit_tracks WHERE id=?').get(id);db.close();
if(!row)throw new Error('Saved hit not found.');
const packet=JSON.parse(row.observation_package_json);
const cleaned=JSON.parse(JSON.stringify(packet,(key,value)=>/image_data_url|evidence_image/.test(key)?undefined:value));
const directory=path.join(root,'demo-output',`saved-ev-${id}-check`);fs.mkdirSync(directory,{recursive:true});
const input=path.join(directory,'observations.json'),output=path.join(directory,'prediction.json');
fs.writeFileSync(input,JSON.stringify(cleaned,null,2));
const result=spawnSync(path.join(root,'.venv-ev/Scripts/python.exe'),['-B','synthetic/direct_video_estimate.py',input,'--db','data/hittrax_from_video.sqlite','--out',output],{cwd:path.join(root,'ev-predictor'),encoding:'utf8',windowsHide:true,timeout:300000,maxBuffer:8*1024*1024});
fs.writeFileSync(path.join(directory,'stderr.txt'),result.stderr||'');
if(result.status!==0)throw new Error(result.error?.message||result.stderr||'Estimator failed');
const prediction=JSON.parse(fs.readFileSync(output)),fit=prediction.direction_first_match;
console.log(JSON.stringify({id,description:row.description,sourceExists:fs.existsSync(packet.video_metadata.source_path),used:fit?.used_count,acceptable:fit?.acceptable,ev:fit?.best?.exit_velocity_mph,launch:fit?.best?.launch_angle_deg,distance:fit?.best?.distance_ft,error:fit?.pixel_error?.rmse_px,marked:packet.hit.distance_observation.distance_ft}));
