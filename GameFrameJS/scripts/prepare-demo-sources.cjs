// Derive recording references from existing data; never edit the library.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const db=new(require('better-sqlite3'))(path.join(root,'app.db'),{readonly:true});
const directory=path.join(root,'demo-output','sources');
fs.mkdirSync(directory,{recursive:true});
try {
 const hit=db.prepare('SELECT id,description,observation_package_json FROM ev_hit_tracks WHERE id=55').get();
 if(!hit) throw new Error('Earlier demo candidate #55 is missing. Choose another verified hit.');
 const packet=JSON.parse(hit.observation_package_json);
 if(!fs.existsSync(packet.video_metadata.source_path)) throw new Error('Original EV source is missing.');
 const cleaned=JSON.parse(JSON.stringify(packet,(key,value)=>/image_data_url|evidence_image/.test(key)?undefined:value));
 const pitch=db.prepare('SELECT id,description,clip_blob,fps,contact_frame,release_frame,release_extension,contact_adjustment,mound_distance FROM pitch_clips WHERE release_frame IS NOT NULL ORDER BY id DESC LIMIT 1').get();
 if(!pitch?.clip_blob?.length) throw new Error('No measured pitch source available.');
 const pitchPath=path.join(directory,'CODEX-DEMO-pitch-source.mp4');
 fs.writeFileSync(pitchPath,pitch.clip_blob);
 delete pitch.clip_blob;
 const manifest={purpose:'Reference data for visible UI reenactment, not a completed recording. Do not silently prefill marks.',ev:{sourceHitId:hit.id,description:hit.description,source:packet.video_metadata.source_path,package:cleaned},pitch:{...pitch,source:pitchPath},plannedOutputs:['EV-and-Swing-Walkthrough.mp4','Pitch-Speed-Walkthrough.mp4','Matchup-Walkthrough.mp4']};
 fs.writeFileSync(path.join(directory,'recording-reference.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({reference:path.join(directory,'recording-reference.json'),hitId:hit.id,pitchId:pitch.id,evSource:packet.video_metadata.source_path,pitchSource:pitchPath}));
} finally {db.close();}
