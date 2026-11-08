const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  await page.route(/https:\/\/(unpkg.com|cdn.jsdelivr.net)\//,r=>r.abort());
  await page.route('**/api/gameframe/options',r=>r.fulfill({json:{teams:[{id:1,name:'Test team'}],hitters:[{id:2,team_id:1,name:'Test player'}]}}));
  await page.route('**/api/gameframe/field-locations',r=>r.fulfill({json:{locations:[]}}));
  const started=Date.now();await page.goto('http://127.0.0.1:8000/ev/predictor.html',{waitUntil:'commit',timeout:60000});
  await page.waitForFunction(()=>typeof openEvPeopleSelection==='function'&&window.L&&window.html2canvas&&els.gameframeTeam.options.length>1);
  const readyMs=Date.now()-started;
  assert.equal(requests.filter(u=>/unpkg.com|cdn.jsdelivr.net/.test(u)).length,0,'No external library requests');
  assert.equal(requests.filter(u=>u.includes('/api/gameframe/ev-hits')).length,0,'No saved-library request during measurement startup');
  await page.evaluate(()=>openSetupModal('geometry'));
  await page.locator('#ev-people-modal').waitFor({state:'visible'});
  await page.locator('#ev-people-form button[type=submit]').click();
  assert.match(await page.locator('#ev-people-status').innerText(),/Choose/);
  await page.locator('#gameframe-team').selectOption('1');await page.locator('#gameframe-hitter').selectOption('2');
  await page.locator('#ev-people-form button[type=submit]').click();
  await page.locator('#actual-field-map-modal').waitFor({state:'visible'});
  assert.equal(await page.locator('.actual-map-loading').count(),0);
  assert.deepEqual(errors,[]);
  const report={readyMs,externalLibraryRequests:0,startupLibraryListRequests:0,playerSelectionToMap:'passed',pageErrors:errors};
  fs.writeFileSync('demo-output/speed-audit-20261105/startup-check.json',JSON.stringify(report,null,2));console.log(report);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
