const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-map-controls-')),'test.db');
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await page.goto(`http://127.0.0.1:${server.address().port}/ev/predictor.html`,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof setActualMapStage==='function'&&!!window.GameFrameEvDialogs);
  await page.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());setActualMapStage('points');els.actualFieldMapModal.showModal();});
  await page.locator('#camera-height-toggle').click();
  console.log('camera height:',await page.evaluate(()=>({open:!document.getElementById('camera-height-panel').hidden,stage:actualMapStage,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>({id:d.id,hidden:d.classList.contains('ev-dialog-inactive')}))})));
  assert.equal(await page.locator('#camera-height-toggle').getAttribute('aria-expanded'),'true');
  await page.locator('#camera-height-ft').fill('11');
  assert.equal(await page.evaluate(()=>buildPackage().camera.height_ft),11);
  await page.evaluate(()=>setActualMapStage('confirm'));
  assert.deepEqual(await page.locator('input[name="landing-certainty"]').evaluateAll(inputs=>inputs.map(i=>i.value)),['guess','area','clear']);
  assert.equal(await page.locator('input[name="landing-certainty"]:checked').inputValue(),'guess');
  await page.locator('input[name="landing-certainty"][value="area"]').check();
  await page.evaluate(()=>{setActualMapStage('points');setActualMapStage('confirm');});
  assert.equal(await page.locator('input[name="landing-certainty"]:checked').inputValue(),'area');
  // Use the real address endpoint, with only this script's isolated database.
  await page.evaluate(async()=>{
   for(const label of ['Field One','Field Two'])await fetch('/api/gameframe/field-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:{label,query:label,lat:40,lon:-74}})});
   savedFieldLocations=(await(await fetch('/api/gameframe/field-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json()).locations;
   renderSavedActualFieldLocations();setActualMapStage('address');
   els.actualFieldSavedLocation.value='0';updateSavedAddressDeleteButton();
  });
  const removed=await page.locator('#actual-field-saved-location option:checked').textContent();
  await page.locator('#actual-field-delete-location').click();
  await page.waitForFunction(()=>savedFieldLocations.length===1);
  assert.equal(await page.evaluate(label=>savedFieldLocations.some(r=>r.label===label),removed),false);
  assert.equal(await page.locator('#actual-field-delete-location').isDisabled(),true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem(ACTUAL_FIELD_SAVED_LOCATIONS_KEY)).length),1);
  const persisted=await page.evaluate(async()=>(await(await fetch('/api/gameframe/field-locations',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json()).locations);
  assert.equal(persisted.length,1);
  console.log('PASS camera height disclosure opens and changes the packaged height.');
  console.log('PASS Low/Medium/High ordering, Low default, preserved choice, and persistent saved-address deletion.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
