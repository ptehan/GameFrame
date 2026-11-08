const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-technical-ui-'));process.env.DB_PATH=path.join(tmp,'test.db');
 const dir='ev-predictor/comparison_output/live';
 const name=fs.readdirSync(dir).filter(n=>n.startsWith('direct_video_estimate_')&&n.endsWith('.json'))
  .sort((a,b)=>fs.statSync(path.join(dir,b)).mtimeMs-fs.statSync(path.join(dir,a)).mtimeMs)
  .find(n=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).direction_first_match?.used);
 const prediction=JSON.parse(fs.readFileSync(process.argv[2]||path.join(dir,name),'utf8'));
 const pkg=JSON.parse(fs.readFileSync(process.argv[3]||path.join(dir,name.replace('direct_video_estimate_','observation_package_')),'utf8'));
 const bytes=fs.readFileSync(pkg.video_metadata.source_path);
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1000},serviceWorkers:'block'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/technical-fixture.mp4',route=>{
   const range=route.request().headers().range;
   if(!range)return route.fulfill({body:bytes,contentType:'video/mp4'});
   const match=/bytes=(\d+)-(\d*)/.exec(range),start=Number(match[1]),end=match[2]?Number(match[2]):bytes.length-1;
   return route.fulfill({status:206,body:bytes.subarray(start,end+1),contentType:'video/mp4',headers:{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Accept-Ranges':'bytes'}});
  });
  await page.route('**/api/predict',route=>route.fulfill({json:prediction}));
  await page.goto(`http://127.0.0.1:${server.address().port}/ev/predictor.html`,{waitUntil:'commit',timeout:60000});
  await page.waitForFunction(()=>typeof renderDirectPredictionCard==='function');
  await page.evaluate(()=>{els.video.src='/technical-fixture.mp4';els.video.load()});
  await page.waitForFunction(()=>els.video.videoWidth>0);
  await page.evaluate(({pkg,prediction})=>{
   document.querySelectorAll('dialog[open]').forEach(d=>d.close());
   state.fileName=pkg.video_metadata.file_name;state.videoMetadata=pkg.video_metadata;
   state.contactTime=pkg.hit.contact.timestamp_s;state.observations=pkg.ball_observations;state.landmarks=pkg.landmarks;
   actualFieldMapState.fieldGeometry=pkg.camera.actual_field_map||pkg.hit.distance_observation.actual_field_map;
   state.latestPrediction=prediction;renderDirectPredictionCard(els.predictionUnconstrained,prediction);
   goToWorkflowStep('player');
  },{pkg,prediction});
  const button=page.locator('#setup-modal [data-ev-technical-toggle]');
  const panel=page.locator('#setup-modal [data-ev-technical-panel]');
  await button.waitFor({state:'visible'});
  const before=await page.evaluate(()=>JSON.stringify([state.observations,state.landmarks]));
  const dialogs=await page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].map(d=>d.id));
  assert.equal(await panel.isVisible(),false);
  await button.click();
  assert.equal(await panel.isVisible(),true);assert.equal(await button.getAttribute('aria-expanded'),'true');
  assert.match(await panel.innerText(),/Why this flight was selected/);
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('dialog[open]')].map(d=>d.id)),dialogs);
  const box=await page.locator('#setup-modal').boundingBox();
  assert.ok(box.x>=-1&&box.y>=-1&&box.x+box.width<=1601&&box.y+box.height<=1001,'technical details must stay inside the viewport');
  fs.mkdirSync('demo-output/technical-details',{recursive:true});
  await page.screenshot({path:'demo-output/technical-details/expanded.png'});
  await button.click();assert.equal(await panel.isVisible(),false);
  await button.focus();await page.keyboard.press('Enter');assert.equal(await panel.isVisible(),true);
  await page.mouse.click(1,1);await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>els.setupModal.open),true);
  assert.equal(await page.evaluate(()=>JSON.stringify([state.observations,state.landmarks])),before);
  await page.evaluate(()=>{closeSetupModal();openPredictionModal()});
  const nativeButton=page.locator('#prediction-modal [data-ev-technical-toggle]');
  const nativePanel=page.locator('#prediction-modal [data-ev-technical-panel]');
  await nativeButton.waitFor({state:'visible'});
  await nativeButton.click();assert.equal(await nativePanel.isVisible(),true);
  await nativeButton.click();assert.equal(await nativePanel.isVisible(),false);
  await nativeButton.focus();await page.keyboard.press('Enter');assert.equal(await nativePanel.isVisible(),true);
  await page.mouse.click(1,1);await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>els.predictionModal.open),true);
  assert.deepEqual(errors,[]);
  console.log('PASS workflow and standalone Technical details panels, keyboard controls, viewport layout, unchanged marks and outside-click protection.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase()}
})().catch(e=>{console.error(e);process.exitCode=1});
