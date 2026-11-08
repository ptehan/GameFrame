const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const Database=require('better-sqlite3');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-matchup-handoff-'));
process.env.DB_PATH=path.join(dir,'test.db');
process.env.FFMPEG_PATH=require('ffmpeg-static');
process.env.FFPROBE_PATH=require('ffprobe-static').path;
const {startServer,closeDatabase}=require('../server');
(async()=>{
 const server=startServer(0,'127.0.0.1');
 await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const db=new Database(process.env.DB_PATH);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const video=path.join(dir,'source.mp4');
  const encode=spawnSync(process.env.FFMPEG_PATH,['-y','-f','lavfi','-i','testsrc2=s=240x320:r=30','-t','2','-c:v','libx264','-pix_fmt','yuv420p',video],{windowsHide:true});
  assert.equal(encode.status,0,encode.stderr?.toString());
  const blob=fs.readFileSync(video);
  db.exec(`CREATE TABLE ev_hit_tracks(id INTEGER PRIMARY KEY, description TEXT, source_file_name TEXT,
   contact_time_s REAL, clip_start_time_s REAL, clip_end_time_s REAL, best_exit_velocity_mph REAL,
   best_launch_angle_deg REAL, best_distance_ft REAL, best_hang_time_s REAL, best_hit_id INTEGER,
   created_at TEXT, hitter_id INTEGER, team_id INTEGER, generated_clip_blob BLOB, clip_blob BLOB);
   CREATE TABLE IF NOT EXISTS ev_swing_links(source_key TEXT PRIMARY KEY, pending_swing_id INTEGER, swing_clip_id INTEGER, ev_hit_id INTEGER);`);
  db.prepare("INSERT INTO teams(id,name) VALUES(1,'CODEX TEST team')").run();
  db.prepare("INSERT INTO pitchers(id,team_id,name) VALUES(1,1,'Pitcher')").run();
  db.prepare("INSERT INTO hitters(id,team_id,name) VALUES(1,1,'Hitter')").run();
  for(const id of [1,2]) {
   db.prepare("INSERT INTO pitch_clips(id,team_id,pitcher_id,description,clip_blob,created_at) VALUES(?,1,1,?,?,?)").run(id,'Pitch '+id,blob,`2026-10-0${id}`);
   db.prepare("INSERT INTO swing_clips(id,team_id,hitter_id,description,clip_blob,created_at) VALUES(?,1,1,?,?,?)").run(id,'Swing '+id,blob,`2026-10-0${id}`);
  }
  for(const width of [1440,390]) {
   const pending=Number(db.prepare("INSERT INTO pending_swing_clips(batch_id,team_id,hitter_id,description,clip_blob,fps,contact_frame) VALUES('test',1,1,'CODEX TEST unfinished',?,30,59)").run(blob).lastInsertRowid);
   const page=await browser.newPage({viewport:{width,height:900},serviceWorkers:'block'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   db.prepare("INSERT INTO ev_hit_tracks(id,description,created_at,hitter_id,team_id) VALUES(?,'CODEX TEST EV','2026-10-23',1,1)").run(width);
   db.prepare('INSERT INTO ev_swing_links(source_key,pending_swing_id,ev_hit_id) VALUES(?,?,?)').run('ev-'+width,pending,width);
   await page.goto(`${origin}/library?type=ev&embedded=1&sid=x`);
   const card=page.locator(`.card-row[data-type="ev"][data-id="${width}"]`);
   await card.locator('summary.library-summary').click();
   assert.match(await card.innerText(),/Contact frame saved/);
   const finish=card.locator('[data-finish-ev-swing]');
   assert.equal(await finish.isVisible(),true);
   const libraryHandoff=await fetch(new URL(await finish.getAttribute('href'),origin),{redirect:'manual'});
   assert.equal(libraryHandoff.status,303);
   const libraryEditor=new URL(libraryHandoff.headers.get('location'),origin);
   assert.equal(libraryEditor.searchParams.get('preset_contact_frame'),'59');
   const libraryReturn=new URL(libraryEditor.searchParams.get('return_url'),origin);
   assert.equal(libraryReturn.pathname,'/library');
   assert.equal(libraryReturn.searchParams.get('type'),'ev');
   assert.equal(libraryReturn.searchParams.get('embedded'),'1');
   // Leaving before finalization must retain both the pending copy and contact.
   await page.reload();
   assert.equal(db.prepare('SELECT contact_frame FROM pending_swing_clips WHERE id=?').get(pending).contact_frame,59);
   const description='CODEX TEST <review> & preserved';
   const query=new URLSearchParams({pitch_id:'1',swing_id:'1',description,embedded:'1',sid:'x'});
   await page.goto(`${origin}/matchup/select?${query}`);
   assert.equal(await page.locator('#pitch_clip').inputValue(),'1');
   await page.locator('#matchup-next').click();
   assert.equal(await page.locator('#swing_clip').inputValue(),'1');
   await page.locator('#swing_clip').selectOption(`pending:${pending}`);
   assert.equal(await page.locator('#matchup-next').innerText(),'Set swing timing');
   await page.screenshot({path:path.join(dir,`pending-${width}.png`)});
   await page.route('**/multi-swing/pending/tag*',route=>route.fulfill({body:'Timing handoff'}));
   await page.locator('#matchup-next').click();await page.waitForURL('**/multi-swing/pending/tag*');
   const handoff=new URL(page.url());
   assert.equal(handoff.searchParams.get('matchup_pitch_id'),'1');
   assert.equal(handoff.searchParams.get('matchup_description'),description);
   const response=await fetch(handoff,{redirect:'manual'});
   assert.equal(response.status,303);
   const editor=new URL(response.headers.get('location'),origin);
   assert.equal(editor.searchParams.get('preset_contact_frame'),'59');
   assert.equal(editor.searchParams.get('embedded'),'1');
   const resume=new URL(editor.searchParams.get('return_url'),origin);
   assert.equal(resume.pathname,'/matchup/select');
   assert.equal(resume.searchParams.get('pitch_id'),'1');
   assert.equal(resume.searchParams.get('description'),description);
   const form=new FormData();
   for(const [key,value] of Object.entries({temp_id:editor.searchParams.get('temp_id'),pending_id:pending,team_id:1,hitter_id:1,start_frame:10,decision_frame_source:20,contact_frame:59,fps:30,description:'CODEX TEST finalized'}))form.append(key,String(value));
   const saved=await fetch(origin+'/upload/swing/finalize',{method:'POST',headers:{Accept:'application/json'},body:form});
   assert.equal(saved.status,200,await saved.clone().text());
   const result=await saved.json();assert.ok(result.swing_id>2);
   const evRecords=await (await fetch(origin+'/library/data?type=ev&sid=x')).json();
   const completed=evRecords.find(row=>row.id===width);
   assert.equal(completed.finish_swing,null);
   assert.equal(completed.swing_clip_id,result.swing_id);
   assert.match(completed.matchup_swing,new RegExp('swing_id='+result.swing_id));
   assert.equal(db.prepare('SELECT id FROM pending_swing_clips WHERE id=?').get(pending),undefined);
   assert.equal(db.prepare('SELECT decision_frame FROM swing_clips WHERE id=?').get(result.swing_id).decision_frame,10);
   resume.searchParams.set('swing_id',result.swing_id);
   await page.goto(resume.href);
   assert.equal(await page.locator('#matchup-step-title').innerText(),'Review matchup');
   assert.equal(await page.locator('#pitch_clip').inputValue(),'1');
   assert.equal(await page.locator('#swing_clip').inputValue(),String(result.swing_id));
   assert.equal(await page.locator('#desc').inputValue(),description);
   assert.equal(await page.locator('#matchup-review-clips .matchup-preview-card').count(),2);
   assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(dir,`resumed-${width}.png`)});
   await page.close();
  }
  console.log('PASS: saved clip preselection, pending swing handoff, real finalization/contact reuse, resume review and description, desktop/mobile. '+dir);
 } finally {await browser.close();db.close();await new Promise(resolve=>server.close(resolve));closeDatabase();}
})().catch(error=>{console.error(error);process.exitCode=1;});
