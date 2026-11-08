const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../ev-predictor');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-map-comparison-'));
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
      const writes=[];
      page.on('pageerror',e=>errors.push(e.message));
      page.on('request',r=>{if(r.method()!=='GET') writes.push(r.url());});
      await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
      await page.waitForFunction(()=>typeof L!=='undefined');
      writes.length = 0; // Initial options loading is a POST read, outside comparison.
      await page.evaluate(({geometry,best})=>{
        actualFieldMapState.fieldGeometry=geometry;
        state.latestPrediction={ev_candidates:[best]};
        window.originalGeometry=JSON.stringify(geometry);
        window.originalPrediction=JSON.stringify(state.latestPrediction);
        openMapComparison();
      },{geometry,best});
      await page.waitForTimeout(400);
      assert.equal(await page.locator('#actual-field-map-modal').getAttribute('data-stage'),'compare');
      assert.equal(await page.locator('#actual-map-continue').isVisible(),false);
      assert.equal(await page.locator('#actual-map-reset').isVisible(),false);
      assert.match(await page.locator('#map-comparison-summary').innerText(),/88 mph.*321 ft/);
      assert.equal(await page.locator('#actual-field-map .leaflet-marker-icon').count(),5);
      const fit=await page.evaluate(()=>{
        const map=actualFieldMapState.map;
        const marks=mapComparisonLayer.getLayers().filter(l=>l instanceof L.Marker);
        const box=els.actualFieldMap.getBoundingClientRect();
        return {zoom:map.getZoom(),allVisible:marks.every(m=>map.getBounds().contains(m.getLatLng())),
          draggable:marks.some(m=>m.dragging?.enabled()),
          labelsVisible:[...els.actualFieldMap.querySelectorAll('.actual-map-marker-label')].every(el=>{
            const r=el.getBoundingClientRect();return r.left>=box.left && r.right<=box.right && r.top>=box.top && r.bottom<=box.bottom;
          }),
          vector:actualMapFieldVectorFt(selectedLandingLatLng(actualFieldMapState.fieldGeometry,state.latestPrediction.ev_candidates[0]),actualFieldMapState.fieldGeometry.home_lat_lng,actualFieldMapState.fieldGeometry.axis_lat_lng)};
      });
      assert.ok(fit.allVisible && fit.labelsVisible,'All marks and labels must fit');
      assert.ok(fit.zoom>=17,'Zoom into the field, not the whole region');
      assert.equal(fit.draggable,false);
      assert.ok(Math.abs(fit.vector.x_ft-best.landing_x_ft)<0.001);
      assert.ok(Math.abs(fit.vector.y_ft-best.landing_y_ft)<0.001);
      await page.screenshot({path:path.join(output,`comparison-${width}.png`)});
      await page.locator('#actual-field-map').click({position:{x:50,y:50}});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#actual-field-map-modal').evaluate(el=>el.open),false);
      assert.equal(await page.evaluate(()=>JSON.stringify(actualFieldMapState.fieldGeometry)===window.originalGeometry),true);
      assert.equal(await page.evaluate(()=>JSON.stringify(state.latestPrediction)===window.originalPrediction),true);
      assert.equal(await page.evaluate(()=>mapComparisonLayer===null),true);
      // Missing predictions/maps remain reviewable and cannot leave an old match.
      await page.evaluate(()=>{state.latestPrediction=null;openMapComparison();});
      assert.equal(await page.locator('#actual-field-map .leaflet-marker-icon').count(),4);
      assert.match(await page.locator('#map-comparison-summary').innerText(),/No matched landing/);
      await page.locator('#actual-map-back-diagram').click();
      await page.evaluate(()=>{actualFieldMapState.fieldGeometry=null;openMapComparison();});
      assert.equal(await page.locator('#actual-field-map .leaflet-marker-icon').count(),0);
      await page.locator('#actual-map-back-diagram').click();
      assert.deepEqual(writes,[],'Opening and closing comparison must never save or recalculate: '+JSON.stringify(writes));
      await page.close();
    }
    assert.deepEqual(errors,[]);
    console.log('PASS map coordinates, desktop/mobile framing and labels, read-only marks, missing data, close/reopen. Screenshots: '+output);
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
