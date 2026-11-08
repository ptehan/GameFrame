// UI/background lifecycle regression only. Uses the measurement freshly computed
// by test-ev-save-first.cjs; no saved result is fed into an estimator or detector.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve('demo-output/save-first-20261105');
const directories=fs.readdirSync(os.tmpdir()).filter(name=>name.startsWith('gameframe-real-workflow-')).map(name=>path.join(os.tmpdir(),name)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs);
let database;
for(const directory of directories){
 const candidate=path.join(directory,'test.db');if(!fs.existsSync(candidate))continue;
 const db=new Database(candidate,{readonly:true});
 try{
  const columns=db.prepare('PRAGMA table_info(ev_hit_tracks)').all();
  if(!columns.some(row=>row.name==='video_render_status'))continue;
  const row=db.prepare('SELECT count(*) AS n FROM ev_hit_tracks').get();
  const team=db.prepare('SELECT name FROM teams LIMIT 1').get();
  if(row.n===1&&team?.name==='Workflow timing test'){database=candidate;break;}
 }finally{db.close();}
}
assert.ok(database,'Run the isolated fresh-analysis workflow test first.');
assert.ok(path.dirname(database).startsWith(path.join(os.tmpdir(),'gameframe-real-workflow-')));
process.env.DB_PATH=database;
const {startServer,closeDatabase}=require('../server');
const report={scope:'Saved-hit playback, timing handoff and background encoding only; no inference',database,errors:[]};
(async()=>{
 const db=new Database(database);const row=db.prepare('SELECT id,best_exit_velocity_mph FROM ev_hit_tracks').get();assert.equal(row.best_exit_velocity_mph,83);
 db.prepare("UPDATE ev_hit_tracks SET generated_clip_blob=NULL,generated_clip_path=NULL,video_render_status='error',video_render_error='Lifecycle retry test' WHERE id=?").run(row.id);db.close();
 const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const response=await fetch(base+'/api/gameframe/retry-ev-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:row.id})});assert.equal(response.status,200);
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});page.on('pageerror',error=>report.errors.push(error.message));
  let t=Date.now();await page.goto(base+'/play/ev?id='+row.id,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.getElementById('ev-saved-video').readyState>=2);
  assert.match(await page.locator('#ev-saved-video').getAttribute('src'),/kind=source/);
  assert.equal(await page.locator('#ev-video-download').isDisabled(),true);
  report.sourceReplaySeconds=(Date.now()-t)/1000;
  await page.screenshot({path:path.join(out,'library-while-rendering.png')});
  const list=await(await fetch(base+'/library/data?type=ev')).json();assert.equal(list[0].video_ready,false);assert.ok(['queued','rendering'].includes(list[0].video_status));
  assert.ok(list[0].pending_swing_id);
  t=Date.now();await page.goto(base+'/multi-swing/pending/tag?id='+list[0].pending_swing_id,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof frames!=='undefined'&&frames.length>0&&!swingTagBusy,null,{timeout:60000});
  report.timingReadySeconds=(Date.now()-t)/1000;await page.screenshot({path:path.join(out,'timing-background-priority.png')});
  await browser.close();
  const deadline=Date.now()+240000;let status;
  do{status=await(await fetch(base+'/api/gameframe/ev-video-status?id='+row.id)).json();if(['ready','error'].includes(status.status))break;await new Promise(r=>setTimeout(r,1000));}while(Date.now()<deadline);
  assert.equal(status.status,'ready',JSON.stringify(status));report.finishedWithoutBrowser=true;
  const final=await fetch(base+'/stream/ev-clip?id='+row.id+'&kind=generated');assert.equal(final.status,200);fs.writeFileSync(path.join(out,'background-priority-video.mp4'),Buffer.from(await final.arrayBuffer()));
  assert.deepEqual(report.errors,[]);console.log(JSON.stringify(report));
 }finally{fs.writeFileSync(path.join(out,'background-ui.json'),JSON.stringify(report,null,2));await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(error=>{console.error(error);process.exitCode=1});
