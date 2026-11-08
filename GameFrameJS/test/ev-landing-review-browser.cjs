const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../ev-predictor');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-landing-review-'));
const fixture = path.join(output, 'test.mp4');
const made = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','4','-c:v','libx264','-pix_fmt','yuv420p',fixture]);
assert.equal(made.status,0,made.stderr?.toString());
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/static/js/workflow-help.js') {
    res.setHeader('Content-Type','application/javascript');
    return fs.createReadStream(path.join(root,'../static/js/workflow-help.js')).pipe(res);
  }
  if(pathname==='/test.mp4') {res.setHeader('Content-Type','video/mp4'); return fs.createReadStream(fixture).pipe(res);}
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({locations:[], teams:[{id:1,name:'Test Team'}],hitters:[{id:1,name:'Test Hitter',team_id:1}],hits:[]}));
  }
  const file = path.join(root,pathname==='/'?'predictor.html':pathname);
  if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) { res.statusCode=404; return res.end(); }
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[];
  try {
    for(const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>typeof L!=='undefined');
      await page.evaluate(()=>{
        window.html2canvas=null;
        els.video.src='/test.mp4';
        state.contactTime=1;
        initializeActualFieldMap();
        setActualMapStage('points');
        for(const point of [[42.886,-78.878],[42.8861,-78.878],[42.8863,-78.878],[42.8869,-78.8782]]) actualMapPlacePoint(L.latLng(...point));
        state.latestPrediction={direction_first_match:{best:{distance_ft:270}},field_direction:{estimated_distance_ft:324}};
        window.originalLanding=JSON.stringify(actualFieldMapState.landing);
        openLandingReview();
      });
      await page.waitForTimeout(300);
      await page.waitForFunction(()=>document.getElementById('actual-map-video').readyState>=2);
      await page.locator('#actual-map-video').evaluate(async video=>{video.muted=true;await video.play();});
      await page.waitForFunction(()=>document.getElementById('actual-map-video').currentTime>0.7);
      await page.locator('#actual-map-video').evaluate(video=>video.pause());
      assert.equal(await page.locator('#actual-field-map-modal').getAttribute('data-stage'),'review');
      assert.equal(await page.locator('#actual-map-video').isVisible(),true);
      assert.equal(await page.evaluate(()=>actualFieldMapState.homeMarker.dragging.enabled()),false);
      await page.screenshot({path:path.join(output,`review-${width}.png`)});
      const confirm=await page.locator('#actual-map-continue').boundingBox();
      assert.ok(confirm.y+confirm.height<=900, 'Review actions must remain on screen');
      const map=await page.locator('#actual-field-map').boundingBox();
      const video=await page.locator('#actual-map-video').boundingBox();
      assert.ok(map.width>150 && video.width>150);
      if(width>700) assert.ok(video.x>=map.x+map.width);
      else assert.ok(video.y>=map.y+map.height);
      await page.evaluate(()=>actualMapPlacePoint(L.latLng(42.8869,-78.8781)));
      assert.equal(await page.locator('#actual-field-map-modal').getAttribute('data-stage'),'review');
      await page.locator('#actual-map-back-diagram').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(actualFieldMapState.landing)===window.originalLanding),true);
      assert.equal(await page.evaluate(()=>actualFieldMapState.homeMarker.dragging.enabled()),true);
      await page.evaluate(()=>{openLandingReview();actualMapPlacePoint(L.latLng(42.8869,-78.8781));});
      await page.locator('#actual-map-keep-original').click();
      assert.equal(await page.evaluate(()=>JSON.stringify(actualFieldMapState.landing)===window.originalLanding),true);
      assert.equal(await page.evaluate(()=>needsLandingReview()),false);
      await page.evaluate(async()=>{
        await openActualFieldMapModal();
        setActualMapStage('confirm');
      });
      await page.locator('#actual-map-video-panel').evaluate(el=>el.open=false);
      assert.equal(await page.locator('#actual-map-video').isVisible(),false);
      await page.locator('#actual-map-video-panel summary').click();
      assert.equal(await page.locator('#actual-map-video').isVisible(),true);
      await page.evaluate(()=>{
        closeActualFieldMapModal();
        state.observations=[{relative_time_s:0,image_x:100,image_y:200},{relative_time_s:1/3,image_x:50,image_y:80}];
        window.originalObservations=JSON.stringify(state.observations);
        state.latestPrediction={direction_first_match:{best:{distance_ft:200}},field_direction:{estimated_distance_ft:324}};
        window.predictCount=0;
        runLivePrediction=async()=>{
          window.predictCount++;
          state.latestPrediction={field_direction:{estimated_distance_ft:actualFieldMapState.distanceFt},ev_candidates:[]};
          return state.latestPrediction;
        };
        openLandingReview();
        actualMapPlacePoint(L.latLng(42.88685,-78.8781));
      });
      await page.locator('#actual-map-continue').click();
      await page.waitForFunction(()=>window.predictCount===1);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.observations)===window.originalObservations),true);
      assert.equal(await page.evaluate(()=>actualFieldMapState.landing.lng),-78.8781);
      assert.equal(await page.evaluate(()=>document.getElementById('actual-field-map-modal').open),false);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS desktop/mobile review, playback, click update, cancel/keep restore, landmark locks, expandable video, recalculation preserving ball tags. Screenshots: '+output);
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
