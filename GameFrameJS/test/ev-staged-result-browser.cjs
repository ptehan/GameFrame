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
 const prediction=JSON.parse(fs.readFileSync('demo-output/staged-production-83.json','utf8'));
 const pack=JSON.parse(fs.readFileSync('demo-output/separated-geometry-audit-83/raw-inputs.json','utf8'));
 pack.hit.gameframe_team_id=1;pack.hit.gameframe_hitter_id=1;
 try {
  for(const width of [1440,390]) {
   const page=await browser.newPage({viewport:{width,height:900}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
   await page.evaluate(async({prediction,pack})=>{
    await loadGameFrameOptions();
    loadPackageIntoState(pack);state.latestPrediction=prediction;
    renderDirectPredictionCard(els.predictionUnconstrained,prediction);
    workflowDetailsConfirmed=false;prepareClippedVideo=async()=>null;
    runWorkflowExport=async()=>{window.exportedPipeline=state.latestPrediction.estimation_pipeline;};
    goToWorkflowStep('player');
   },{prediction,pack});
   assert.match(await page.locator('#setup-controls-slot').innerText(),/Early marks constrain launch angle/);
   assert.match(await page.locator('#setup-controls-slot').innerText(),/Later|later/);
   assert.equal(await page.locator('#workflow-gameframe-team').count(),0);
   assert.equal(await page.locator('#workflow-gameframe-hitter').count(),0);
   assert.equal(await page.locator('#setup-title').innerText(),'Prediction and Video');
   assert.equal(await page.locator('#setup-continue').innerText(),'Save video');
   assert.equal(await page.evaluate(()=>selectedGameFrameTeamId()),1);
   assert.equal(await page.evaluate(()=>selectedGameFrameHitterId()),1);
   assert.equal(await page.locator('#setup-continue').isDisabled(),false);
   await page.screenshot({path:path.join(output,`staged-result-${width}.png`)});
   await page.locator('#setup-continue').click();
   await page.waitForFunction(()=>window.exportedPipeline==='early_geometry_then_late_height');
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Staged production result renders and can export at desktop and phone widths. '+output);
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
