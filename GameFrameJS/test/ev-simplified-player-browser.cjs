// Run explicitly with PLAYWRIGHT_MODULE set when Playwright is not installed locally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawnSync} = require('node:child_process');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../ev-predictor');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-guided-ev-'));
const fixture = path.join(output, 'test.mp4');
const made = spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','4','-c:v','libx264','-pix_fmt','yuv420p',fixture]);
assert.equal(made.status, 0, made.stderr?.toString());
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/static/css/guided-workspace.css' || pathname === '/static/js/guided-workspace.js') {
    res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css':'application/javascript');
    return fs.createReadStream(path.join(root,'..',pathname)).pipe(res);
  }
  if (['/static/js/workflow-help.js','/static/js/tagging-fullscreen.js','/static/js/ev-draft-store.js'].includes(pathname)) {
    res.setHeader('Content-Type','application/javascript');
    return fs.createReadStream(path.join(root,'../static/js',path.basename(pathname))).pipe(res);
  }
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    if (pathname.endsWith('field-locations')) return res.end(JSON.stringify({locations:[{label:'Saved Field',query:'Saved Field',lat:42.8864,lon:-78.8784}]}));
    if (pathname.endsWith('options')) return res.end(JSON.stringify({teams:[{id:1,name:'Test Team'},{id:2,name:'Other Team'}],hitters:[{id:1,name:'Test Hitter',team_id:1},{id:2,name:'Other Hitter',team_id:2}]}));
    return res.end(JSON.stringify({hits:[]}));
  }
  const file = path.join(root, pathname === '/' ? 'predictor.html' : pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.statusCode=404;return res.end();}
  res.setHeader('Content-Type', file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const width of [1440,390,844]) {
   const height=width===844?390:900;
   const page=await browser.newPage({viewport:{width,height}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.evaluate(async()=>{
    await loadGameFrameOptions();
    window.predictionCalls=0;
    runLivePrediction=async()=>{window.predictionCalls++;return null;};
    prepareClippedVideo=async()=>null;
    actualFieldMapGeometryReady=()=>true;
    state.observations=[{relative_time_s:0,image_x:100,image_y:100},{relative_time_s:.333,image_x:200,image_y:50}];
    renderGameFrameOptions({preferredTeamId:1,preferredHitterId:1});
    els.hitDescription.value='Earlier description';
    goToWorkflowStep('player');
   });
   await page.waitForFunction(()=>window.predictionCalls===1);
   assert.equal(await page.locator('#workflow-gameframe-team').count(),0);
   assert.equal(await page.locator('#workflow-gameframe-hitter').count(),0);
   assert.equal(await page.locator('#workflow-hit-description').count(),0);
   assert.equal(await page.locator('#setup-title').innerText(),'Prediction and Video');
   assert.equal(await page.locator('#setup-continue').innerText(),'Save video');
   assert.equal(await page.evaluate(()=>selectedGameFrameTeamId()),1);
   assert.equal(await page.evaluate(()=>selectedGameFrameHitterId()),1);
   assert.equal(await page.evaluate(()=>els.hitDescription.value),'Earlier description');
   await page.screenshot({path:path.join(output,`player-${width}.png`)});
   await page.evaluate(()=>goToWorkflowStep('groundChoice'));
   assert.equal(await page.locator('#setup-continue').innerText(),'Yes');
   assert.equal(await page.locator('#setup-secondary').innerText(),'No');
   assert.equal(await page.locator('#setup-back').isVisible(),false);
   await page.screenshot({path:path.join(output,`yes-no-${width}.png`)});
   await page.evaluate(()=>{
    els.setupModal.close();setActualMapStage('confirm');els.actualFieldMapModal.showModal();
   });
   assert.equal(await page.locator('#actual-map-back-diagram').isVisible(),false);
   assert.equal(await page.locator('#actual-map-reset').isVisible(),false);
   assert.equal(await page.locator('#actual-field-map-modal .workflow-start-over').count(),1);
   const certainty=await page.locator('#landing-certainty').boundingBox();
   assert.ok(certainty.y>=0&&certainty.y+certainty.height<height,'All certainty choices fit');
   const body=await page.locator('.actual-field-map-body').boundingBox();
   assert.ok(certainty.y+certainty.height<=body.y+body.height+1,'Certainty choices are not clipped by body');
   await page.screenshot({path:path.join(output,`certainty-${width}.png`)});
   await page.evaluate(()=>els.actualFieldMapModal.close());
   await page.evaluate(async()=>{
    const file=new File(['video'],'restart.mp4',{type:'video/mp4'});
    state.videoFile=file;
    GameFrameEvDrafts.schedule({file,package:{video_metadata:{file_name:file.name}}});
    await GameFrameEvDrafts.flush();
    if(!await GameFrameEvDrafts.read()) throw new Error('draft did not save');
    loadVideoFile=next=>{window.restartedFile=next.name;};
    await restartWorkflow();
    if(await GameFrameEvDrafts.read()) throw new Error('restart left a stored draft');
    if(window.restartedFile!==file.name) throw new Error('restart lost source video');
   });
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('Preserved earlier selections, automatic processing, Save video, and Yes/No pass at desktop and phone widths. '+output);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
