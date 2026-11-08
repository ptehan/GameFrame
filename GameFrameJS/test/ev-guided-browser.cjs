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
  if (['/static/js/workflow-help.js','/static/js/tagging-fullscreen.js'].includes(pathname)) {
    res.setHeader('Content-Type','application/javascript');
    return fs.createReadStream(path.join(root,'../static/js',path.basename(pathname))).pipe(res);
  }
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    if (pathname.endsWith('field-locations')) return res.end(JSON.stringify({locations:[{label:'Saved Field',query:'Saved Field',lat:42.8864,lon:-78.8784}]}));
    if (pathname.endsWith('options')) return res.end(JSON.stringify({teams:[{id:1,name:'Test Team'}],hitters:[{id:1,name:'Test Hitter',team_id:1}]}));
    return res.end(JSON.stringify({hits:[]}));
  }
  const file = path.join(root, pathname === '/' ? 'predictor.html' : pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.statusCode=404;return res.end();}
  res.setHeader('Content-Type', file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser = await chromium.launch({channel:'msedge',headless:true});
  const errors=[];
  try {
    for (const width of [1440,390]) {
      const page = await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>typeof L !== 'undefined');
      await page.evaluate(()=>{
        window.html2canvas=null;
        detectContactFromAudio=async()=>{};
        window.predictionCalls=0;
        runLivePrediction=async()=>{window.predictionCalls++;throw new Error('Test stops before paid/heavy prediction');};
        detectFlightFromVideo=async()=>{
          state.autoObservations=manualBallObservations().map(row=>({...row,source:'auto',confidence:'HIGH'}));
        };
      });
      await page.locator('#video-file').setInputFiles(fixture);
      await page.waitForFunction(()=>document.getElementById('actual-field-saved-location').options.length===2);
      assert.equal(await page.locator('#actual-field-map').isVisible(),false);
      await page.locator('#actual-field-saved-location').selectOption('0');
      await page.screenshot({path:path.join(output,`address-${width}.png`)});
      await page.locator('#actual-map-continue').click();
      const map = page.locator('#actual-field-map');
      const fieldType=await page.locator('#field-size').boundingBox();
      const cameraButton=await page.locator('#actual-map-camera-step').boundingBox();
      assert.ok(Math.abs(fieldType.y+fieldType.height-cameraButton.y-cameraButton.height)<4,'Field type and map buttons must share a row');
      await page.waitForTimeout(300);
      const box = await map.boundingBox();
      assert.ok(box.width>200 && box.height>150,JSON.stringify(box));
      const points=[[.5,.8],[.5,.65],[.5,.45],[.63,.2]];
      for (let i=0;i<points.length;i++) {
        const [x,y]=points[i];
        const click={x:box.x+box.width*x,y:box.y+box.height*y};
        await page.mouse.click(click.x,click.y);
        if(i===0){
          const dot=await page.locator('.actual-map-marker-dot').first().boundingBox();
          assert.ok(Math.abs(dot.x+dot.width/2-click.x)<=1 && Math.abs(dot.y+dot.height/2-click.y)<=1,`marker offset: ${JSON.stringify({dot,click})}`);
        }
      }
      assert.equal(await page.locator('#actual-field-map-modal').getAttribute('data-stage'),'confirm');
      await page.screenshot({path:path.join(output,`map-${width}.png`)});
      await page.locator('input[name="landing-certainty"][value="area"]').check();
      await page.locator('#actual-map-continue').click();
      const expected=['Tag Home Plate','Tag the Pitching Rubber','Tag a visible point on the first-base line','Tag another point farther along the first-base line','Tag a visible point on the third-base line','Tag another point farther along the third-base line'];
      for(const [i,title] of expected.entries()){
        assert.equal(await page.locator('#setup-title').innerText(),title);
        assert.equal(await page.locator('.workflow-viewer-slot .transport').isVisible(),true);
        assert.equal(await page.locator('#setup-continue').isVisible(),false);
        if(i===0){
          const fullscreen=page.locator('#setup-modal > .setup-card > .setup-heading .tagging-fullscreen-button');
          await fullscreen.click();
          assert.equal(await page.locator('#setup-modal').evaluate(el=>el.classList.contains('tagging-fullscreen-target')),true);
          assert.equal(await page.locator('#timeline').isVisible(),true);
          assert.equal(await page.locator('#back-frame').isVisible(),true);
          assert.equal(await page.locator('#forward-frame').isVisible(),true);
          await page.screenshot({path:path.join(output,`tag-fullscreen-${width}.png`)});
          await fullscreen.click();
        }
        await page.locator('#overlay').click({position:{x:100+i*10,y:80+i*8}});
        if(i===0){
          await page.locator('#workflow-undo-field-mark').click();
          assert.equal(await page.evaluate(()=>state.landmarks.length),0);
          assert.equal(await page.locator('#setup-title').innerText(),'Tag Home Plate');
          await page.locator('#overlay').click({position:{x:100,y:80}});
        }
      }
      assert.equal(await page.locator('.workflow-viewer-slot .transport').isVisible(),true);
      await page.evaluate(()=>seekVideoTo(1));
      await page.waitForFunction(()=>!document.getElementById('video').seeking);
      await page.locator('#overlay').click({position:{x:100,y:100}});
      await page.waitForFunction(()=>!document.getElementById('video').seeking);
      assert.match(await page.locator('#setup-title').innerText(),/10 frames/);
      assert.equal(await page.locator('.workflow-viewer-slot .transport').isVisible(),true);
      const time=await page.locator('#video').evaluate(v=>v.currentTime);
      await page.keyboard.press('ArrowRight');
      await page.waitForFunction(previous=>document.getElementById('video').currentTime>previous,time);
      await page.keyboard.press('ArrowLeft');
      await page.waitForFunction(previous=>Math.abs(document.getElementById('video').currentTime-previous)<.001&&!document.getElementById('video').seeking,time);
      await page.locator('#overlay').click({position:{x:150,y:60}});
      await page.waitForFunction(()=>document.getElementById('setup-modal').dataset.step==='groundChoice');
      await page.screenshot({path:path.join(output,`ground-choice-${width}.png`)});
      await page.locator('#setup-continue').click();
      assert.equal(await page.locator('.workflow-viewer-slot .transport').isVisible(),true);
      await page.locator('#ground-view-zoom').evaluate(el=>{el.value='3';el.dispatchEvent(new Event('input',{bubbles:true}));});
      assert.equal(await page.locator('#ground-view-zoom-label').innerText(),'3×');
      const groundBox=await page.locator('#overlay').boundingBox();
      await page.mouse.move(groundBox.x+groundBox.width/2,groundBox.y+groundBox.height/2);
      await page.mouse.down();
      await page.mouse.move(groundBox.x+groundBox.width/2+30,groundBox.y+groundBox.height/2+20,{steps:5});
      await page.mouse.up();
      assert.equal(await page.evaluate(()=>state.terminalEvent),null);
      const expectedPoint=await page.evaluate(()=>{
        const r=els.overlay.getBoundingClientRect();
        return displayToVideoPoint({clientX:r.left+r.width/2,clientY:r.top+r.height/2});
      });
      await page.locator('#overlay').click({position:{x:groundBox.width/2,y:groundBox.height/2}});
      const tagged=await page.evaluate(()=>state.terminalEvent);
      assert.ok(tagged,'A click after panning must tag ground contact');
      assert.ok(Math.abs(tagged.image_x-expectedPoint.x)<1);
      assert.ok(Math.abs(tagged.image_y-expectedPoint.y)<1);
      await page.screenshot({path:path.join(output,`ground-zoom-${width}.png`)});
      await page.locator('#setup-secondary').click();
      assert.equal(await page.locator('#workflow-gameframe-team').isVisible(),true);
      if (process.argv.includes('--tagging-only')) {
        assert.equal(await page.evaluate(()=>groundView.zoom),1);
        assert.equal(await page.evaluate(()=>state.terminalEvent),null);
        await page.evaluate(()=>{state.latestPrediction={distance_review:{required:true}};});
        await page.locator('#setup-back').click();
        assert.equal(await page.locator('#setup-modal').getAttribute('data-step'),'ballPath');
        const markCount=await page.evaluate(()=>manualBallObservations().length);
        await page.locator('#workflow-edit-flight-ball').click();
        await page.waitForFunction(()=>!els.video.seeking);
        await page.locator('#overlay').click({position:{x:160,y:70}});
        assert.equal(await page.evaluate(()=>manualBallObservations().length),markCount);
        assert.equal(await page.locator('#setup-modal').getAttribute('data-step'),'ballPath');
        assert.equal(await page.evaluate(()=>state.latestPrediction),null);
        await page.locator('#workflow-edit-contact-ball').click();
        await page.waitForFunction(()=>!els.video.seeking);
        await page.locator('#overlay').click({position:{x:110,y:110}});
        assert.equal(await page.evaluate(()=>manualBallObservations().length),markCount);
        assert.equal(await page.evaluate(()=>manualBallObservations().find(row=>row.relative_time_s===0).role),'CONTACT_POINT');
        await page.screenshot({path:path.join(output,`edit-ball-marks-${width}.png`)});
        const homeBefore=await page.evaluate(()=>state.landmarks.find(row=>row.landmark==='home_plate'));
        await page.locator('#workflow-edit-field-marks').click();
        await page.locator('#workflow-landmark-select').selectOption('home_plate');
        await page.waitForFunction(()=>!els.video.seeking);
        await page.locator('#overlay').click({position:{x:115,y:95}});
        assert.equal(await page.locator('#setup-modal').getAttribute('data-step'),'landmarks');
        assert.equal(await page.evaluate(()=>state.landmarks.length),6);
        assert.notEqual(await page.evaluate(()=>state.landmarks.find(row=>row.landmark==='home_plate').image_x),homeBefore.image_x);
        await page.locator('#workflow-undo-field-mark').click();
        assert.equal(await page.evaluate(()=>state.landmarks.find(row=>row.landmark==='home_plate').image_x),homeBefore.image_x);
        await page.screenshot({path:path.join(output,`edit-field-marks-${width}.png`)});
        await page.locator('#setup-continue').click();
        assert.equal(await page.locator('#setup-modal').getAttribute('data-step'),'ballPath');
        assert.equal(await page.evaluate(()=>manualBallObservations().length),markCount);
        await page.close();
        continue;
      }
      assert.equal(await page.locator('.workflow-export-combined').isVisible(),false);
      assert.equal(await page.evaluate(()=>window.predictionCalls),0);
      await page.locator('#workflow-gameframe-team').selectOption('1');
      await page.locator('#workflow-gameframe-hitter').selectOption('1');
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('gameframe-ev-people'))),{team:1,hitter:1});
      await page.evaluate(async()=>{
        els.gameframeTeam.value=''; els.gameframeHitter.value='';
        await loadGameFrameOptions();
      });
      assert.equal(await page.evaluate(()=>selectedGameFrameHitterId()),1);
      await page.evaluate(async()=>{
        localStorage.setItem('gameframe-ev-people',JSON.stringify({team:999,hitter:999}));
        els.gameframeTeam.value=''; els.gameframeHitter.value='';
        await loadGameFrameOptions();
      });
      assert.ok(!(await page.evaluate(()=>selectedGameFrameHitterId())));
      await page.locator('#workflow-gameframe-team').selectOption('1');
      await page.locator('#workflow-gameframe-hitter').selectOption('1');
      await page.locator('#workflow-hit-description').fill('Guided test');
      await page.screenshot({path:path.join(output,`details-${width}.png`)});
      await page.locator('#setup-continue').click();
      await page.waitForFunction(()=>window.predictionCalls===1);
      await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes('Test stops'));
      assert.equal(await page.locator('#workflow-gameframe-team').isVisible(),true);
      await page.route('**/api/gameframe/ev-clip*',route=>route.fulfill({contentType:'video/mp4',path:fixture}));
      await page.evaluate(()=>{
        closeSetupModal();
        state.gameframe.savedHitId=123;
        state.gameframe.pendingSwingId=456;
        state.gameframe.swingSaveWarning='';
        window.taggedPendingId=null;
        openSavedSwingTiming=id=>{window.taggedPendingId=id;};
        showEvCompletion();
      });
      await page.waitForFunction(()=>document.getElementById('ev-complete-video').readyState>=2);
      assert.equal(await page.locator('#ev-complete-timing').isVisible(),true);
      assert.match(await page.locator('#ev-complete-download').getAttribute('href'),/id=123/);
      await page.screenshot({path:path.join(output,`ev-complete-${width}.png`)});
      await page.locator('#ev-complete-timing').click();
      assert.equal(await page.evaluate(()=>window.taggedPendingId),456);
      assert.equal(await page.locator('#ev-complete-modal').evaluate(el=>el.open),false);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS: desktop/mobile EV tagging, fullscreen, frame controls, zoom/pan, ground-contact coordinates and view reset${process.argv.includes('--tagging-only')?'':', metadata and completion flow'}. Screenshots: ${output}`);
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
