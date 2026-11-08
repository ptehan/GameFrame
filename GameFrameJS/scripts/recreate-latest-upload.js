const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname,'..');
const out = path.join(root,'demo-output','recreate-latest');
const base = 'http://localhost:8000';
const db = new Database(path.join(root,'app.db'),{readonly:true});
const pitch = db.prepare('SELECT * FROM pitch_clips WHERE id=60').get();
async function main() {
  if (process.argv[2] === 'upload') {
    const form = new FormData();
    form.set('team_id',String(pitch.team_id)); form.set('pitcher_id',String(pitch.pitcher_id));
    form.set('description','Recreated 60 FPS test');
    form.set('file',new Blob([fs.readFileSync(path.join(os.homedir(),'Downloads','1000056365.mp4'))]),'1000056365.mp4');
    const response = await fetch(`${base}/upload/pitch`,{method:'POST',body:form,redirect:'manual'});
    if(response.status!==303) throw new Error(await response.text());
    const location = response.headers.get('location');
    const id = new URL(location,base).searchParams.get('temp_id');
    const raw = await fetch(`${base}/raw/pitch?id=${id}`);
    if(!raw.ok) throw new Error(await raw.text());
    fs.writeFileSync(path.join(out,'uploaded.mp4'),Buffer.from(await raw.arrayBuffer()));
    fs.writeFileSync(path.join(out,'upload.json'),JSON.stringify({id,location}));
    console.log(location);
    return;
  }
  const {id} = JSON.parse(fs.readFileSync(path.join(out,'upload.json')));
  const match = JSON.parse(fs.readFileSync(path.join(out,'contact-match.json')));
  const corners = match.crop_corners_640x360;
  const x = (corners[0][0]+corners[3][0])/2/640;
  const y = (corners[0][1]+corners[1][1])/2/360;
  const crop = {enabled:true,x,y,w:(corners[1][0]+corners[2][0])/2/640-x,h:(corners[2][1]+corners[3][1])/2/360-y};
  const form = new FormData();
  for(const [key,value] of Object.entries({temp_id:id,team_id:pitch.team_id,pitcher_id:pitch.pitcher_id,
    description:'Recreated 60 FPS test',contact_frame:match.source_frame,portrait_crop:JSON.stringify(crop),video_created_at:pitch.video_created_at})) form.set(key,String(value));
  const before = db.prepare('SELECT max(id) AS id FROM pitch_clips').get().id;
  const response = await fetch(`${base}/upload/pitch/finalize`,{method:'POST',body:form});
  if(!response.ok) throw new Error(await response.text());
  const saved = db.prepare("SELECT id,contact_frame,fps FROM pitch_clips WHERE id>? AND description='Recreated 60 FPS test' ORDER BY id DESC LIMIT 1").get(before);
  if(!saved) throw new Error('Recreated pitch not found');
  console.log('Saved pitch:',JSON.stringify(saved));
  const result = await fetch(`${base}/matchup/create`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({pitch_id:String(saved.id),swing_id:'126',description:'Recreated 60 FPS test'})});
  if(!result.ok) throw new Error(await result.text());
  const matchup = await result.json();
  fs.writeFileSync(path.join(out,'recreated.json'),JSON.stringify({pitch:saved,matchup,crop,source_contact_frame:match.source_frame},null,2));
  console.log('Created matchup:',JSON.stringify(matchup));
}
main().catch(error => {console.error(error);process.exitCode=1;}).finally(()=>db.close());
