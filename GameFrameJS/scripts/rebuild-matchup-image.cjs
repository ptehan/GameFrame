// Rebuild one saved matchup image; keep its video and all timing data unchanged.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Database=require('better-sqlite3');
const id=Number(process.argv[2]);if(!Number.isSafeInteger(id)||id<=0)throw new Error('Supply a matchup ID.');
const sourceDb=path.resolve('app.db'),library=new Database(sourceDb,{readonly:true});
const matchup=library.prepare('SELECT * FROM matchups WHERE id=?').get(id);
if(!matchup)throw new Error('Matchup not found');
const pitch=library.prepare('SELECT p.*,n.name AS player_name FROM pitch_clips p LEFT JOIN pitchers n ON n.id=p.pitcher_id WHERE p.id=?').get(matchup.pitch_clip_id);
const swing=library.prepare('SELECT s.*,n.name AS player_name FROM swing_clips s LEFT JOIN hitters n ON n.id=s.hitter_id WHERE s.id=?').get(matchup.swing_clip_id);
library.close();
process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-image-rebuild-')),'isolated.db');
const {buildMatchupVideoServerSide,closeDatabase}=require('../server');
try{
 const built=buildMatchupVideoServerSide({pitchBlob:pitch.clip_blob,swingBlob:swing.clip_blob,description:matchup.description||'',
  hitterName:swing.player_name||'Hitter',pitcherName:pitch.player_name||'Pitcher',
  swingLabel:`Swing #${swing.id} • ${swing.description||'Untitled swing'} • ${swing.created_at||'date unknown'}`,
  swingSeconds:swing.swing_seconds,decisionFrame:swing.decision_frame,
  swingContactFrame:swing.frame_count-1,pitchContactFrame:pitch.contact_frame});
 const output=path.resolve('demo-output',`matchup-${id}-image-corrected`);fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'previous.jpg'),matchup.collage_blob);
 fs.writeFileSync(path.join(output,'corrected.jpg'),built.collage);
 const db=new Database(sourceDb);
 try{const result=db.prepare('UPDATE matchups SET collage_blob=? WHERE id=? AND pitch_clip_id=? AND swing_clip_id=? AND collage_blob=?')
  .run(built.collage,id,matchup.pitch_clip_id,matchup.swing_clip_id,matchup.collage_blob);
  if(result.changes!==1)throw new Error('Matchup changed during rendering; image was not replaced.');
 }finally{db.close();}
 console.log(`Corrected saved matchup ${id}; original image backed up at ${output}`);
}finally{closeDatabase();}
