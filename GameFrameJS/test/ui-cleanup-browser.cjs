const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf-ui-cleanup-'));
process.env.DB_PATH=path.join(dir,'test.db');
const {startServer,closeDatabase}=require('../server');
const db=new (require('better-sqlite3'))(process.env.DB_PATH);
db.prepare('INSERT INTO teams (id,name) VALUES (1,?)').run('Test Team');
db.prepare('INSERT INTO hitters (id,name,team_id) VALUES (1,?,1)').run('Test Hitter');
db.close();
(async()=>{
 const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const errors=[];
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:900}});
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(origin,{waitUntil:'domcontentloaded'});
   const main=await page.locator('#main').boundingBox();
   assert.ok(main.width>Math.min(300,width-30),JSON.stringify(main));
   if(width===390){
    assert.equal(await page.locator('.responsive-menu').getAttribute('open'),null);
    await page.locator('.responsive-menu summary').click();
   }
   await page.locator('[data-modal-title="Library"]').click();
   await page.frameLocator('#menu-flow-frame').locator('#filter_type').waitFor().catch(async error=>{
    await page.screenshot({path:path.join(dir,'failure.png')});
    console.error({width,errors,frames:page.frames().map(f=>f.url()),body:(await page.locator('body').innerText()).slice(0,1200),dir});
    throw error;
   });
   await page.locator('#menu-flow-close').click();
   await page.screenshot({path:path.join(dir,`home-${width}.png`)});
   await page.goto(origin+'/dashboard/player?hid=1',{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('.dashboard-layout-picker').count(),0);
   await page.screenshot({path:path.join(dir,`dashboard-${width}.png`)});
   await page.goto(origin+'/matchup/select?embedded=1',{waitUntil:'domcontentloaded'});
   assert.equal(await page.locator('#matchup-step-title').innerText(),'Choose a pitch');
   assert.ok((await page.locator('#matchup-step-title').boundingBox()).width>100);
   assert.equal(await page.locator('#pitch_team').isVisible(),true);
   assert.equal(await page.locator('#swing_team').isVisible(),false);
   await page.locator('#matchup-next').click();
   assert.equal(await page.locator('#matchup-step-title').innerText(),'Choose a pitch');
   assert.equal(await page.locator('#matchup-wizard-error').isVisible(),true);
   await page.screenshot({path:path.join(dir,`matchup-${width}.png`)});
   for(const type of ['pitch','swing','ev','matchup']){
    await page.goto(`${origin}/library?type=${type}&embedded=1`,{waitUntil:'domcontentloaded'});
    assert.equal(await page.locator('#filter_pitcher').isVisible(),['pitch','matchup'].includes(type));
    assert.equal(await page.locator('#filter_hitter').isVisible(),type!=='pitch');
   }
   await page.waitForLoadState('networkidle');
   for(const type of ['pitch','swing']){
    await page.evaluate(type=>buildGrid([{id:42,type,description:'CODEX TEST actions',team_name:'Test',pitcher_name:'Pitcher',hitter_name:'Hitter',play:'/play/'+type+'?id=42',delete:'/unused',created_at:'2026-10-22'}]),type);
    await page.locator('.library-summary').click();
    assert.equal(await page.locator('[data-library-download]').getAttribute('href'),`/stream/${type}?id=42`);
    const target=new URL(await page.locator('[data-library-matchup]').getAttribute('href'),origin);
    assert.equal(target.pathname,'/matchup/select');assert.equal(target.searchParams.get(type+'_id'),'42');assert.equal(target.searchParams.get('embedded'),'1');
    assert.equal(await page.getByRole('button',{name:'Edit Description',exact:true}).isVisible(),false);
    await page.locator('.library-more-actions summary').click();
    assert.equal(await page.getByRole('button',{name:'Edit Description',exact:true}).isVisible(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(dir,`library-actions-${type}-${width}.png`)});
   }
   await page.evaluate(()=>buildGrid([{id:42,type:'pitch',description:'CODEX TEST saved export',play:'/play/pitch?id=42',speed_export_saved:true,speed_export:'/download/pitch-speed?id=42',initial_mph:80,average_mph:76}]));
   await page.locator('.library-summary').click();
   assert.equal(await page.locator('[data-library-download]').count(),0);
   assert.equal(await page.getByRole('button',{name:'Download Saved Export'}).isVisible(),true);
   assert.equal(await page.locator('[data-pitch-speed-review]').count(),0);
   await page.evaluate(()=>buildGrid([{id:43,type:'swing',is_pending:1,description:'CODEX TEST pending',play:'/multi-swing/pending/tag?id=43'}]));
   assert.equal(await page.locator('[data-library-matchup]').count(),0);
   assert.equal(await page.locator('[data-library-download]').count(),0);
   await page.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`PASS: desktop/mobile home, menu, dashboard, matchup columns, relevant library filters. Screenshots: ${dir}`);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1;});
