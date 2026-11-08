const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const folder=path.resolve('demo-output/cortland-double-85-wide'),ids=JSON.parse(fs.readFileSync(path.join(folder,'preparation.json')));
 process.env.DB_PATH=ids.snapshot;const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage();
  for(const [width,height]of [[1440,900],[390,844]]){
   await page.setViewportSize({width,height});const response=await page.goto(`http://127.0.0.1:${server.address().port}/matchup/select?pitch_id=${ids.pitch_id}&swing_id=${ids.swing_id}&embedded=1`,{waitUntil:'networkidle'});assert.equal(response.status(),200);
   await page.waitForFunction(id=>document.querySelector('#pitch_clip')?.value===String(id),ids.pitch_id);await page.waitForTimeout(200);
   const boxes=await page.evaluate(()=>Object.fromEntries(['pitch_team','pitch_pitcher','pitch_clip','pitch_clip_preview','matchup-next'].map(id=>{const r=document.getElementById(id).getBoundingClientRect();return[id,{x:r.x,y:r.y,right:r.right,bottom:r.bottom}]})));
   assert.equal(boxes.pitch_team.x,boxes.pitch_pitcher.x);assert.equal(boxes.pitch_team.x,boxes.pitch_clip.x);
   assert(boxes['matchup-next'].y>=Math.max(boxes.pitch_clip.bottom,boxes.pitch_clip_preview.bottom));
   assert(Object.values(boxes).every(b=>b.x>=0&&b.right<=width+1&&b.bottom<=height));
   await page.screenshot({path:path.join(folder,`selection-layout-${width}.png`)});console.log('PASS aligned selection '+width+'x'+height);
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
