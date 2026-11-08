const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../ev-predictor');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-map-comparison-'));
const fixture = path.join(output, 'test.mp4');
const made = require('node:child_process').spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-t','2','-c:v','libx264','-pix_fmt','yuv420p',fixture]);
assert.equal(made.status,0,made.stderr?.toString());
const geometry = {
  home_lat_lng: {lat:42.5554076168878,lng:-76.23768888638094},
  axis_lat_lng: {lat:42.55516290688227,lng:-76.23733479458981},
  camera_lat_lng: {lat:42.555496422700884,lng:-76.23778009184227},
  landing_lat_lng: {lat:42.55506784436939,lng:-76.23663874877062},
};
const best = {hit_id:'test',exit_velocity_mph:88,launch_angle_deg:21,spray_angle_deg:-10,
  distance_ft:320.524,landing_x_ft:-58.822,landing_y_ft:315.08};
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  if (pathname === '/test.mp4') {res.setHeader('Content-Type','video/mp4');return fs.createReadStream(fixture).pipe(res);}
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type','application/json');
    return res.end(JSON.stringify({locations:[],teams:[],hitters:[],hits:[]}));
  }
  const file = pathname === '/static/js/workflow-help.js'
    ? path.resolve(root,'../static/js/workflow-help.js') : path.join(root,pathname==='/'?'predictor.html':pathname);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {res.statusCode=404; return res.end();}
  res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');
  fs.createReadStream(file).pipe(res);
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[];
  try {
    for (const width of [1440,390]) {
      const page=await browser.newPage({viewport:{width,height:900}});
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>typeof L!=='undefined');
      await page.evaluate(({geometry,best})=>{
        els.video.src='/test.mp4';
        state.contactTime=0;
        actualFieldMapState.fieldGeometry=geometry;
        state.observations=[{relative_time_s:0,image_x:100,image_y:200},{relative_time_s:.2,image_x:160,image_y:120}];
        window.originalObservations=JSON.stringify(state.observations);
        state.latestPrediction={ev_candidates:[best],distance_review:{required:true,status:'distance_conflict',
          title:'Review your landing mark',message:'No good video match supports the entered distance.',claimed_distance_ft:400,
          observed_pixels:[[100,200],[160,120]],alternatives:[
            {...best,distance_ft:280,projected_pixels:[[100,201],[160,122]]},
            {...best,distance_ft:300,landing_y_ft:290,projected_pixels:[[101,200],[163,120]]},
            {...best,distance_ft:320,landing_y_ft:310,projected_pixels:[[99,200],[162,123]]}
          ]}};
        renderDirectPredictionCard(els.predictionUnconstrained,state.latestPrediction);
        goToWorkflowStep('player');
      },{geometry,best});
      await page.waitForFunction(()=>document.getElementById('distance-review-video').readyState>=2);
      assert.equal(await page.locator('#keep-landing-point').count(),0);
      assert.equal(await page.locator('#setup-continue').isDisabled(),true);
      assert.equal(await page.locator('#distance-review-overlay polyline').count(),3);
      assert.equal(await page.locator('#distance-review-overlay circle').count(),2);
      assert.match(await page.locator('.landing-review-notice').innerText(),/120 ft shorter/);
      assert.equal(await page.evaluate(()=>practicalEstimate()),null);
      await page.locator('#compare-match-map').click();
      assert.equal(await page.locator('#actual-field-map .leaflet-marker-icon').count(),7);
      assert.match(await page.locator('#map-comparison-summary').innerText(),/Match 3/);
      await page.locator('#actual-map-back-diagram').click();
      await page.screenshot({path:path.join(output,`required-review-${width}.png`)});
      await page.locator('#review-video-marks').click();
      assert.equal(await page.evaluate(()=>activeWorkflowStep),'ballPath');
      assert.equal(await page.evaluate(()=>JSON.stringify(state.observations)===window.originalObservations),true);
      await page.evaluate(()=>{
        goToWorkflowStep('player');
        window.recalculations=0;
        runLivePrediction=async()=>{window.recalculations++;state.latestPrediction={ev_candidates:[],distance_review:{required:false,status:'supported',alternatives:[]}};};
      });
      await page.locator('#review-recalculate').click();
      await page.waitForFunction(()=>window.recalculations===1);
      assert.equal(await page.locator('#review-recalculate').count(),0);
      assert.equal(await page.evaluate(()=>needsLandingReview()),false);
      await page.evaluate(()=>{
        state.latestPrediction={distance_review:{required:true,status:'insufficient_video_evidence',title:'Review the video marks and camera setup',message:'We could not establish a good video match.',alternatives:[]}};
        goToWorkflowStep('player');
      });
      assert.equal(await page.locator('#distance-review-overlay').count(),0);
      assert.match(await page.locator('.landing-review-notice').innerText(),/could not establish a good video match/);
      assert.equal(await page.locator('#setup-continue').isDisabled(),true);
      await page.evaluate(()=>{
        state.latestPrediction={distance_review:{required:true,status:'camera_setup_conflict',
          title:'Check camera setup — distance has not been tested',message:'Trajectory matching has not run.',alternatives:[],
          camera_comparison:{mapped_center_ft:[-31,-21,6],suggested_center_ft:[-20,-50,6],mapped_distance_ft:38,suggested_distance_ft:54,position_difference_ft:31,camera_height_ft:6}}};
        goToWorkflowStep('player');
      });
      assert.match(await page.locator('.landing-review-notice').innerText(),/54 ft from home/);
      assert.equal(await page.locator('#review-landing-point').count(),0);
      await page.locator('#review-camera-comparison').click();
      assert.match(await page.locator('#map-comparison-summary').innerText(),/distance has not been tested/);
      assert.equal(await page.locator('#actual-field-map .leaflet-marker-icon').count(),5);
      await page.locator('#actual-map-back-diagram').click();
      await page.locator('#review-field-marks').click();
      assert.equal(await page.evaluate(()=>activeWorkflowStep),'landmarks');
      assert.equal(await page.evaluate(()=>JSON.stringify(state.observations)===window.originalObservations),true);
      await page.evaluate(({best})=>{
        state.latestPrediction={distance_review:{required:true,title:'Review tracking',message:'Review automatic tracking first.',alternatives:[],claimed_distance_ft:320,
          observed_pixels:[[100,200],[160,120]],diagnostic_alternatives:[
            {...best,distance_ft:322,projected_path_rmse_px:29,comparison_label:'Near your marked distance — not accepted',projected_pixels:[[100,200],[160,120]]},
            {...best,distance_ft:461,projected_path_rmse_px:17.8,comparison_label:'Closest video fit ignoring distance — not accepted',projected_pixels:[[100,201],[160,122]]}]}};
        goToWorkflowStep('player');
      },{best});
      const comparisons=await page.locator('.landing-review-notice li').allTextContents();
      assert.match(comparisons[0],/Near your marked distance.*322 ft.*29.0 px error/);
      assert.match(comparisons[1],/ignoring distance.*461 ft/);
      assert.equal(await page.locator('#distance-review-overlay polyline').count(),2);
      assert.equal(await page.locator('#setup-continue').isDisabled(),true);
      await page.evaluate(()=>{
        state.latestPrediction.distance_review.contact_pixel=[100,200];
        state.latestPrediction.distance_review.observed_pixels=[[160,120]];
        state.latestPrediction.distance_review.diagnostic_alternatives.forEach(row=>row.projected_pixels=[[162,122]]);
        goToWorkflowStep('player');
      });
      assert.equal(await page.locator('#distance-review-overlay polyline').first().getAttribute('points'),'100,200 162,122');
      assert.equal(await page.locator('#distance-review-overlay circle').count(),2);
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS required distance review, alternatives, map, video overlay, correction navigation, recalculation and weak evidence on desktop/mobile. Screenshots: '+output);
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
