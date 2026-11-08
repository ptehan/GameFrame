// Reads existing source clips only; rendering and schema initialization use an isolated database.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..'),database=new Database(process.env.DB_PATH||path.join(root,'app.db'),{readonly:true});
const pitch=database.prepare('SELECT * FROM pitch_clips WHERE clip_blob IS NOT NULL ORDER BY id DESC LIMIT 1').get();
const swing=database.prepare('SELECT * FROM swing_clips WHERE clip_blob IS NOT NULL ORDER BY id DESC LIMIT 1').get();
database.close();if(!pitch||!swing)throw Error('Saved pitch and tagged swing required');
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'gf-matchup-profile-'));
process.env.DB_PATH=path.join(scratch,'isolated.db');process.env.FFMPEG_PATH=require('ffmpeg-static');process.env.FFPROBE_PATH=require('ffprobe-static').path;
const {buildMatchupVideoServerSide,closeDatabase}=require('../server');
try{
 const started=performance.now();console.log('Rendering saved pitch and swing in isolation...');
 const result=buildMatchupVideoServerSide({pitchBlob:pitch.clip_blob,swingBlob:swing.clip_blob,description:'Performance verification',hitterName:'Hitter',pitcherName:'Pitcher',swingLabel:'Timing verification',swingSeconds:swing.swing_seconds,decisionFrame:swing.decision_frame,pitchContactFrame:pitch.contact_frame,swingContactFrame:swing.frame_count-1});
 const seconds=(performance.now()-started)/1000;
 const out=path.join(root,'demo-output','matchup-performance-20261105',process.argv[2]||'current');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'video.mp4'),result.blob);fs.writeFileSync(path.join(out,'collage.jpg'),result.collage);
 const report={seconds,bytes:result.blob.length,pitchId:pitch.id,swingId:swing.id};fs.writeFileSync(path.join(out,'timing.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{closeDatabase();}
