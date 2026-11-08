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
  for(const fps of [30,60]) {
   const page=await browser.newPage({viewport:{width:1280,height:900}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.locator('#video-file').setInputFiles(fixture);
   await page.waitForFunction(()=>els.video.videoWidth>0);
   await page.evaluate(rate=>{
    if(els.actualFieldMapModal.open)els.actualFieldMapModal.close();
    state.frameStepS=1/rate; state.frameTimes=[];
    state.contactTime=1;state.contactFrameTime=1;
    state.observations=[{source:'HUMAN',role:'CONTACT_POINT',video_time_s:1,relative_time_s:0,image_x:100,image_y:200}];
    goToWorkflowStep('ballPath');
   },fps);
   await page.waitForFunction(()=>!els.video.seeking&&Math.abs(els.video.currentTime-(1+1/3))<.002);
   assert.equal(await page.locator('#setup-continue').isVisible(),false);
   await page.locator('#overlay').click({position:{x:220,y:160}});
   assert.equal(await page.locator('#setup-continue').isVisible(),true);
   await page.waitForFunction(()=>ballDetectionSeedReadiness().phase==='needs_later_ball'&&!els.video.seeking);
   assert.ok(Math.abs(await page.evaluate(()=>els.video.currentTime)-1.5)<.002);
   assert.match(await page.locator('#setup-title').innerText(),new RegExp(`${fps===60?30:15} frames`));
   await page.screenshot({path:path.join(output,`third-mark-${fps}.png`)});
   await page.locator('#overlay').click({position:{x:280,y:130}});
   await page.waitForFunction(()=>ballDetectionSeedReadiness().phase==='needs_frame20_ball'&&!els.video.seeking);
   assert.ok(Math.abs(await page.evaluate(()=>els.video.currentTime)-(1+2/3))<.002);
   assert.match(await page.locator('#setup-title').innerText(),new RegExp(`${fps===60?40:20} frames`));
   await page.locator('#overlay').click({position:{x:310,y:110}});
   await page.waitForFunction(()=>ballDetectionSeedReadiness().phase==='needs_frame25_ball'&&!els.video.seeking);
   assert.ok(Math.abs(await page.evaluate(()=>els.video.currentTime)-(1+5/6))<.002);
   assert.match(await page.locator('#setup-title').innerText(),new RegExp(`${fps===60?50:25} frames`));
   await page.locator('#overlay').click({position:{x:330,y:90}});
   await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight30'&&!els.video.seeking);
   assert.equal(await page.locator('#setup-continue').isVisible(),true);
   await page.locator('#overlay').click({position:{x:350,y:80}});
   await page.waitForFunction(()=>ballDetectionSeedReadiness().markKey==='flight35'&&!els.video.seeking);
   assert.equal(await page.evaluate(()=>activeWorkflowStep),'ballPath');
   await page.locator('#setup-continue').click();
   await page.waitForFunction(()=>activeWorkflowStep==='landmarks');
   for(let tag=0;tag<6;tag++) {
    await page.waitForFunction(()=>!els.video.seeking);
    const labels=await page.locator('#setup-modal button:visible').allTextContents();
    assert.deepEqual(labels.map(s=>s.trim()),['Not visible','Start over']);
    await page.locator('#overlay').click({position:{x:120+tag*30,y:180+tag*20}});
   }
   await page.waitForFunction(()=>activeWorkflowStep==='groundChoice');
   const marks=await page.evaluate(()=>manualBallObservations().map(p=>p.relative_time_s));
   assert.equal(marks.length,6);assert.ok(Math.abs(marks[2]-.5)<.002);
   await page.evaluate(rate=>{
    state.contactTime=null;state.contactFrameTime=null;state.observations=[];state.landmarks=[];state.skippedVideoMarks=[];
    state.frameStepS=1/rate;state.frameTimes=[];state.ballPathAudioStarted=true;
    goToWorkflowStep('contact');
   },fps);
   await page.waitForFunction(()=>!els.video.seeking);
   await page.locator('.workflow-not-visible').click();
   for(const phase of ['needs_frame5_ball','needs_later_ball','needs_frame20_ball','needs_frame25_ball']) {
    await page.waitForFunction(expected=>ballDetectionSeedReadiness().phase===expected&&!els.video.seeking,phase);
    await page.locator('.workflow-not-visible').click();
   }
   assert.equal(await page.evaluate(()=>activeWorkflowStep),'ballPath');
   await page.locator('#setup-continue').click();
   await page.waitForFunction(()=>activeWorkflowStep==='landmarks');
   assert.equal(await page.evaluate(()=>state.observations.length),0);
   assert.deepEqual(await page.evaluate(()=>buildPackage().skipped_video_marks),['contact','flight10','flight15','flight20','flight25']);
   for(let tag=0;tag<6;tag++) await page.locator('.workflow-not-visible').click();
   await page.waitForFunction(()=>activeWorkflowStep==='groundChoice');
   assert.equal(await page.evaluate(()=>state.landmarks.length),0);
   assert.equal(await page.evaluate(()=>buildPackage().skipped_video_marks.length),11);
   await page.locator('#setup-secondary').click();
   assert.equal(await page.locator('#setup-continue').isDisabled(),true);
   assert.match(await page.locator('#setup-controls-slot').innerText(),/Not enough visible ball marks/);
   await page.screenshot({path:path.join(output,`skipped-marks-${fps}.png`)});
   await page.evaluate(rate=>{
    state.contactTime=1;state.contactFrameTime=1;state.frameStepS=1/rate;state.frameTimes=[];state.landmarks=[];state.skippedVideoMarks=[];
    state.observations=[{source:'HUMAN',role:'CONTACT_POINT',relative_time_s:0,video_time_s:1,image_x:100,image_y:200}];
    goToWorkflowStep('ballPath');
   },fps);
   await page.waitForFunction(()=>!els.video.seeking);
   await page.locator('#overlay').click({position:{x:220,y:160}});
   await page.locator('#setup-continue').click();
   await page.waitForFunction(()=>activeWorkflowStep==='landmarks');
   assert.equal(await page.evaluate(()=>state.observations.length),2);
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Continuous optional marking workflow passed at 30 and 60 fps. '+output);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
