const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const [pitchId, swingId] = process.argv.slice(2).map(Number);
if (!pitchId || !swingId) throw new Error('Usage: node scripts/verify-saved-matchup.js PITCH_ID SWING_ID');
const library = new Database(process.env.DB_PATH || path.join(root, 'app.db'), {readonly:true});
const pitch = library.prepare('SELECT * FROM pitch_clips WHERE id=?').get(pitchId);
const swing = library.prepare('SELECT * FROM swing_clips WHERE id=?').get(swingId);
library.close();
if (!pitch || !swing) throw new Error('Selected pitch or swing not found');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-matchup-verify-'));
process.env.DB_PATH = path.join(temporary, 'isolated.db');
process.env.FFMPEG_PATH = require('ffmpeg-static');
process.env.FFPROBE_PATH = require('ffprobe-static').path;
const { buildMatchupVideoServerSide, closeDatabase } = require('../server');
try {
  const started = performance.now();
  const result = buildMatchupVideoServerSide({pitchBlob:pitch.clip_blob,swingBlob:swing.clip_blob,
    description:`Pitch ${pitchId} / Swing ${swingId}`,hitterName:'Hitter',pitcherName:'Pitcher',
    swingLabel:`Swing ${swingId}`,swingSeconds:swing.swing_seconds,decisionFrame:swing.decision_frame,
    pitchContactFrame:pitch.contact_frame,swingContactFrame:swing.frame_count-1});
  const output = path.join(root, 'demo-output', `matchup-${pitchId}-${swingId}-verified`);
  fs.mkdirSync(output,{recursive:true});
  const video = path.join(output, 'matchup.mp4');
  fs.writeFileSync(video,result.blob);
  fs.writeFileSync(path.join(output,'collage.jpg'),result.collage);
  const probe = spawnSync(process.env.FFPROBE_PATH,['-v','error','-count_frames','-select_streams','v:0',
    '-show_entries','stream=width,height,nb_read_frames,duration,r_frame_rate','-of','json',video],{encoding:'utf8'});
  if (probe.status !== 0) throw new Error(probe.stderr);
  const stream = JSON.parse(probe.stdout).streams[0];
  if (stream.r_frame_rate !== '60/1') throw new Error('Matchup must render at 60 FPS');
  if (!(Number(stream.nb_read_frames)>240)) throw new Error('Matchup lacks expected body frames');
  const still = spawnSync(process.env.FFMPEG_PATH,['-v','error','-y','-ss','5','-i',video,'-frames:v','1',path.join(output,'body.jpg')]);
  if (still.status !== 0) throw new Error(still.stderr.toString());
  console.log(JSON.stringify({video,...stream,elapsedSeconds:(performance.now()-started)/1000},null,2));
} finally {
  closeDatabase();
  fs.rmSync(temporary,{recursive:true,force:true});
}
