const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const library=new Database(path.resolve('app.db'),{readonly:true});
 const swing=library.prepare('SELECT clip_blob,fps,frame_count FROM swing_clips ORDER BY id DESC LIMIT 1').get();library.close();
 process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-swing-warm-')),'test.db');
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const db=new Database(process.env.DB_PATH);
 const id=Number(db.prepare('INSERT INTO pending_swing_clips(batch_id,clip_blob,fps,contact_frame) VALUES(?,?,?,?)').run('preload-test',swing.clip_blob,swing.fps,swing.frame_count-1).lastInsertRowid);db.close();
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
  page.on('pageerror',e=>console.log('BROWSER ERROR:',e.message));
  page.on('response',r=>{if(r.status()>=400)console.log('HTTP ERROR:',r.status(),r.url())});
  let poseDownloads=0;
  await page.route('**/npm/@tensorflow/**',route=>{
   poseDownloads++;return route.fulfill({contentType:'application/javascript',body:'window.tf={setBackend:async()=>{},ready:async()=>{}};'});
  });
  await page.route('**/npm/@tensorflow-models/**',route=>{
   poseDownloads++;return route.fulfill({contentType:'application/javascript',body:'window.poseDetection={movenet:{modelType:{MULTIPOSE_LIGHTNING:"test"}},TrackerType:{BoundingBox:"test"},SupportedModels:{MoveNet:"test"},createDetector:async()=>({ready:true})};'});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{const modal=document.getElementById('menu-flow-modal');modal.showModal();modal.dataset.flow='ev';document.getElementById('ev-video-start').hidden=true;const frame=document.getElementById('menu-flow-frame');frame.hidden=false;frame.src='/ev/predictor.html';});
  const ev=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  await ev.waitForFunction(()=>typeof preloadSavedSwingVideo==='function');
  await ev.evaluate(id=>preloadSavedSwingVideo(id),id);
  await page.locator('iframe[title="Preparing swing timing"]').waitFor({state:'attached'});
  const prepared=await(await page.locator('iframe[title="Preparing swing timing"]').elementHandle()).contentFrame();
  try {await prepared.waitForFunction(()=>document.getElementById('info')?.textContent.startsWith('Frames: '),{},{timeout:45000});}
  catch(error){console.log('Prepared editor:',prepared.url(),await prepared.locator('body').innerText());throw error;}
  await prepared.evaluate(()=>window.preloadSentinel='decoded once');
  assert.equal(poseDownloads,0,'manual timing must not wait for pose libraries');
  await ev.evaluate(id=>openSavedSwingTiming(id),id);
  await page.waitForFunction(()=>document.getElementById('menu-flow-frame').contentWindow.preloadSentinel==='decoded once');
  assert.equal(await page.locator('iframe[title="Preparing swing timing"]').count(),0);
  assert.equal(await page.locator('#menu-flow-frame').isVisible(),true);
  const active=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
  assert.equal(await active.evaluate(count=>document.getElementById('info').textContent.includes(`Frames: ${count} | FPS:`),swing.frame_count),true);
  assert.equal(await active.evaluate(()=>ensurePose().then(detector=>detector.ready)),true);
  assert.equal(poseDownloads,2,'pose tools must still load when explicitly requested');
  console.log('PASS real saved swing decoded in background; opening timing reuses the same ready iframe and frames.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
