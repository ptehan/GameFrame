const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');

test('original pitch upload survives trimming, speed measurement, and pending promotion', {timeout:360000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-pitch-source-'));
 process.env.DB_PATH=path.join(dir,'app.db');
 const childProcess=require('node:child_process'),originalSpawn=childProcess.spawnSync,probes=[];
 childProcess.spawnSync=(exe,args,...options)=>{
  if(args.includes('-show_entries')&&args.includes('-of')&&args.includes('json'))probes.push([...args]);
  return originalSpawn(exe,args,...options);
 };
 const {startServer,closeDatabase}=require('../server');
 const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const db=new Database(process.env.DB_PATH),base=`http://127.0.0.1:${server.address().port}`;
 const fixture=path.join(dir,'original.mp4');
 const generated=spawnSync(require('ffmpeg-static'),['-v','error','-y','-f','lavfi','-i','color=c=blue:s=96x96:r=30:d=3','-f','lavfi','-i','sine=frequency=440:duration=3','-c:v','libx264','-preset','ultrafast','-c:a','aac','-shortest',fixture],{windowsHide:true});
 assert.equal(generated.status,0,generated.stderr?.toString());
 const original=fs.readFileSync(fixture),hash=crypto.createHash('sha256').update(original).digest('hex');
 const team=Number(db.prepare('INSERT INTO teams(name) VALUES(?)').run('Source test').lastInsertRowid);
 const pitcher=Number(db.prepare('INSERT INTO pitchers(name,team_id) VALUES(?,?)').run('Hilton test',team).lastInsertRowid);
 const form=values=>{const body=new FormData();for(const[k,v]of Object.entries(values))body.set(k,String(v));return body;};
 const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',body,redirect:'manual'});assert(r.ok||r.status===303,`${url}: ${r.status} ${await r.clone().text()}`);return r;};
 const checkOriginal=async(id,pending=false)=>{
  const r=await fetch(base+`/original/pitch?id=${id}${pending?'&pending=1':''}`);assert.equal(r.status,200);
  assert.match(r.headers.get('content-disposition'),/Hilton original/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),original);
 };
 try{
  const upload=form({team_id:team,pitcher_id:pitcher,start_sec:0});upload.set('file',new Blob([original]),'Hilton original.mp4');
  const response=await post('/upload/pitch',upload),redirect=new URL(response.headers.get('location'),base),tempId=redirect.searchParams.get('temp_id');
  assert.ok(probes.length>0);assert.equal(probes[0].includes('-count_frames'),false,'Original upload must read metadata without decoding the entire recording');
  const source=db.prepare('SELECT * FROM pitch_video_sources WHERE id=?').get(tempId);
  assert.equal(source.original_file_name,'Hilton original.mp4');assert.equal(source.sha256,hash);
  assert.deepEqual(fs.readFileSync(path.join(dir,'source-videos',source.stored_file_name)),original);
  const finalize=await post('/upload/pitch/finalize',form({temp_id:tempId,team_id:team,pitcher_id:pitcher,contact_frame:45}));
  const saved=await finalize.json();await checkOriginal(saved.pitch_id);
  assert.ok(probes.some(args=>args.includes('-count_frames')),'Frame-exact counts remain enabled for the short tagging/finalization clips');
  assert(!fs.existsSync(path.join(os.tmpdir(),`gf_${tempId}.mp4`)));
  await post('/api/pitch/speed',new URLSearchParams({pitch_id:saved.pitch_id,release_frame:30,mound_distance:60.5,extension:6,contact_adjustment:3}));
  await checkOriginal(saved.pitch_id);
  const page=await(await fetch(base+`/play/pitch?id=${saved.pitch_id}`)).text();assert.match(page,/Hilton original.mp4/);assert.match(page,/\/original\/pitch\?id=/);
  const listed=await(await fetch(base+'/library/data?type=pitch')).json();assert.equal(listed.find(p=>p.id===saved.pitch_id&&!p.is_pending).source_file_name,'Hilton original.mp4');
  const pending=Number(db.prepare(`INSERT INTO pending_pitch_clips(batch_id,team_id,pitcher_id,description,clip_blob,fps,contact_frame,status,source_video_id) VALUES(?,?,?,?,?,?,?,'pending',?)`).run('ev-source-test',team,pitcher,'Pending',original,30,45,tempId).lastInsertRowid);
  await checkOriginal(pending,true);
  const promoted=await post('/multi-pitch/pending/speed',new URLSearchParams({id:pending,pitcher_id:pitcher}));
  const promotedId=Number(new URL(promoted.headers.get('location'),base).searchParams.get('id'));await checkOriginal(promotedId);
  assert.equal(db.prepare('SELECT id FROM pending_pitch_clips WHERE id=?').get(pending),undefined);
  const legacy=Number(db.prepare('INSERT INTO pitch_clips(team_id,pitcher_id,clip_blob,fps,contact_frame) VALUES(?,?,?,?,?)').run(team,pitcher,original,30,45).lastInsertRowid);
  assert.equal((await fetch(base+`/original/pitch?id=${legacy}`)).status,404);
  assert.equal((await fetch(base+'/original/pitch?id=../../app.db')).status,404);
  const batchUpload=form({team_id:team,pitcher_id:pitcher});batchUpload.set('file',new Blob([original]),'Hilton original.mp4');
  const analyzed=await(await post('/multi-pitch/analyze',batchUpload)).json();
  const split=await fetch(base+'/multi-pitch/split',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({temp_id:analyzed.temp_id,markers:[1.5],team_id:team,pitcher_id:pitcher,source_name:'Untrusted client label.mp4'})});
  assert.equal(split.status,200,await split.clone().text());const batch=await split.json();
  await checkOriginal(batch.ids[0],true);
  const tag=await fetch(base+`/multi-pitch/pending/tag?id=${batch.ids[0]}`,{redirect:'manual'});assert.equal(tag.status,303);
  const tagTemp=new URL(tag.headers.get('location'),base).searchParams.get('temp_id');
  const completed=await(await post('/upload/pitch/finalize',form({temp_id:tagTemp,team_id:team,pitcher_id:pitcher,contact_frame:45,pending_pitch_id:batch.ids[0]}))).json();
  await checkOriginal(completed.pitch_id);assert.equal(db.prepare('SELECT id FROM pending_pitch_clips WHERE id=?').get(batch.ids[0]),undefined);
  console.log('Verified exact original bytes, filename, saved location, temporary-file cleanup, Library visibility, speed save, pending promotion, and legacy handling.');
 }finally{childProcess.spawnSync=originalSpawn;db.close();await new Promise(r=>server.close(r));closeDatabase();}
});
