const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-guided-'));
 process.env.DB_PATH=path.join(dir,'test.db');
 const {startServer,closeDatabase}=require('../server');
 const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const db=new(require('better-sqlite3'))(process.env.DB_PATH);
 db.exec("INSERT INTO teams(id,name) VALUES(1,'Test'); INSERT INTO hitters(id,team_id,name) VALUES(1,1,'Test');");
 const insert=db.prepare('INSERT INTO swing_clips(id,team_id,hitter_id,clip_blob,description) VALUES(?,1,1,?,?)');
 for(let i=1;i<=35;i++)insert.run(i,Buffer.from([1]),'Test swing '+i);
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
 for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]){
 const page=await browser.newPage({viewport,serviceWorkers:'block'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const route of ['/','/upload/pitch','/upload/swing','/multi-swing','/multi-pitch','/matchup/select','/teams','/hitters','/pitchers','/library?type=swing','/dashboard/player','/dashboard/measurements','/privacy','/terms','/external_video']){
 await page.goto(`http://127.0.0.1:${server.address().port}${route}${route.includes('?')?'&':'?'}sid=x`,{waitUntil:'networkidle'});
 await page.waitForTimeout(150);
 const info=await page.evaluate(()=>({height:innerHeight,doc:document.documentElement.scrollHeight,pages:[...document.querySelectorAll('.gf-page-flow')].map(e=>({w:e.clientWidth,h:e.clientHeight,sw:e.scrollWidth,sh:e.scrollHeight})),scrolling:[...document.querySelectorAll('body *')].filter(e=>e.clientHeight&&e.scrollHeight>e.clientHeight+2&&/auto|scroll/.test(getComputedStyle(e).overflowY)).map(e=>e.id||e.className)}));
 console.log(viewport.width,viewport.height,route,JSON.stringify(info));
 assert.ok(info.doc<=viewport.height+1,route+' document overflow');
 assert.deepEqual(info.scrolling,[],route+' vertical scrolling');
 for(const flow of info.pages)assert.ok(flow.sh<=flow.h+2,route+' clipped vertical content');
 if(route==='/upload/swing')assert.equal(info.pages[0].sw% (info.pages[0].w+24),info.pages[0].w,'Swing width must fit full columns');
 if(route==='/upload/swing'&&viewport.height>500){
  await page.locator('#team_select').selectOption('__gf_add');
  await page.waitForFunction(()=>getComputedStyle(document.getElementById('entity_modal')).display!=='none');
  assert.equal(await page.locator('#team_select').inputValue(),'');
  await page.locator('#entity_cancel_btn').click();
  await page.locator('#team_select').selectOption('1');
  await page.locator('#hitter_select option[value="__gf_add"]').waitFor({state:'attached'});
  await page.locator('#hitter_select').selectOption('__gf_add');
  assert.equal(await page.locator('#entity_modal_title').innerText(),'Add Hitter');
  await page.locator('#entity_cancel_btn').click();
 }
 if(route.startsWith('/library')){
   const seen=new Set();
   for(let i=0;i<60;i++){
    (await page.locator('.library-summary').evaluateAll(es=>es.filter(e=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight}).map(e=>e.textContent.trim()))).forEach(t=>seen.add(t));
    const next=page.locator('.gf-page-next');if(!await next.isVisible())break;
    await next.click();await page.waitForTimeout(30);
   }
   assert.equal(seen.size,35,'Every library video must be reachable');
   await page.evaluate(()=>GameFrameWorkspace.page(document.getElementById('main'),0));
   await page.locator('.library-details').first().evaluate(e=>e.open=true);
   await page.waitForTimeout(100);
   const more=page.locator('#library_grid .actions > button').filter({hasText:'More'}).first();
   await more.focus();await more.click();
   assert.equal(await page.locator('.gf-actions-popover:popover-open').count(),1);
   const bounds=await page.locator('.gf-actions-popover:popover-open').boundingBox();
   assert.ok(bounds.y>=0&&bounds.y+bounds.height<=viewport.height,'More actions fit viewport');
   assert.equal(await page.locator('.library-more-actions').count(),0,'Only one secondary menu');
   await page.keyboard.press('Escape');
   const flow=await page.locator('#main').evaluate(e=>({h:e.clientHeight,sh:e.scrollHeight}));
   assert.ok(flow.sh<=flow.h+2,'Expanded library card fits vertically');
 }
 await page.screenshot({path:path.join(dir,`${viewport.width}-${route.replace(/\W/g,'_')}.png`)});
 }
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS guided layouts. Screenshots: '+dir);
 }finally{await browser.close();await new Promise(r=>server.close(r));db.close();closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
