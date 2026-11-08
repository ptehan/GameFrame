const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'demo-output','cortland-double-85-wide');fs.mkdirSync(folder,{recursive:true});
const old=JSON.parse(fs.readFileSync(path.join(root,'demo-output/cortland-double-85/session.json')));
(async()=>{
 const snapshot=path.join(folder,'snapshot.db');
 if(fs.existsSync(path.join(folder,'preparation.json')))throw new Error('Tutorial already prepared.');
 if(!fs.existsSync(snapshot)){const source=new Database(path.join(root,'app.db'),{readonly:true});await source.backup(snapshot);source.close();}
 process.env.DB_PATH=snapshot;
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const db=new Database(snapshot),base=`http://127.0.0.1:${server.address().port}`;
 try{
  const pitch=db.prepare('SELECT * FROM pitch_clips ORDER BY id DESC LIMIT 1').get();
  if(!pitch||pitch.release_frame==null)throw new Error('Latest pitch needs a saved release measurement.');
  const swing=db.prepare('SELECT * FROM swing_clips WHERE id=?').get(old.swing_id);
  const hit=db.prepare('SELECT * FROM ev_hit_tracks WHERE id=?').get(old.hit_id);
  const fps=swing.fps,contact=Math.round(hit.contact_time_s*fps),start=contact-(swing.frame_count-1);
  const wide=path.join(folder,'wide-swing.mp4'),thumb=path.join(folder,'wide-swing.jpg');
  const ffmpeg=require('ffmpeg-static');
  function run(args){const r=spawnSync(ffmpeg,['-v','error','-y',...args],{windowsHide:true,encoding:'utf8'});if(r.status!==0)throw new Error(r.stderr);}
  run(['-i',old.source_path,'-vf',`trim=start_frame=${start}:end_frame=${contact+1},setpts=PTS-STARTPTS,crop=640:720:640:0`,'-an','-c:v','libx264','-preset','ultrafast','-crf','18','-r',String(fps),wide]);
  run(['-sseof','-0.05','-i',wide,'-frames:v','1',thumb]);
  const copy={...swing,clip_blob:fs.readFileSync(wide),library_clip_blob:fs.readFileSync(wide),thumb:fs.readFileSync(thumb),description:'Cortland double — wider swing view',pose_data:null,pose_quality_score:null,pose_quality_status:null};
  const columns=Object.keys(copy).filter(c=>c!=='id');
  const wideSwing=Number(db.prepare(`INSERT INTO swing_clips(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>copy[c])).lastInsertRowid);
  db.prepare('UPDATE ev_swing_links SET swing_clip_id=? WHERE ev_hit_id=? AND swing_clip_id=?').run(wideSwing,old.hit_id,old.swing_id);
  const exportResponse=await fetch(base+`/export/pitch-speed?id=${pitch.id}`);if(!exportResponse.ok)throw new Error(await exportResponse.text());await exportResponse.arrayBuffer();
  const matchupResponse=await fetch(base+'/matchup/create',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({pitch_id:String(pitch.id),swing_id:String(wideSwing),description:'Cortland double — wider pitch and swing views'})});
  if(!matchupResponse.ok)throw new Error(await matchupResponse.text());const matchup=await matchupResponse.json();
  fs.writeFileSync(path.join(folder,'preparation.json'),JSON.stringify({snapshot,hit_id:old.hit_id,pitch_id:pitch.id,swing_id:wideSwing,matchup_id:Number(matchup.id),original_swing_id:swing.id,wide_crop:{x:640,y:0,width:640,height:720},source_start_frame:start,source_contact_frame:contact,decision_frame:swing.decision_frame,frame_count:swing.frame_count},null,2));
  console.log(JSON.stringify({snapshot,pitch:pitch.id,swing:wideSwing,matchup:matchup.id}));
 }finally{db.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
