const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-home-')),'check.db');
 const {startServer,closeDatabase}=require('../server'),server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const output=path.resolve('demo-output/home-actions');fs.mkdirSync(output,{recursive:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'}),base=`http://127.0.0.1:${server.address().port}`;
  for(const [width,height] of [[1440,900],[1366,768],[390,844],[375,667],[844,390]]){
   await page.setViewportSize({width,height});await page.goto(base+'/?sid=x',{waitUntil:'networkidle'});
   await page.waitForTimeout(300);
   const bounds=await page.locator('.gf-home-action').evaluateAll(links=>links.map(a=>{const r=a.getBoundingClientRect();return {title:a.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
   assert.equal(bounds.length,10);
   assert(bounds.every(r=>r.x>=0&&r.y>=0&&r.right<=width+1&&r.bottom<=height+1),JSON.stringify({width,height,bounds}));
   await page.screenshot({path:path.join(output,`${width}x${height}.png`)});console.log('PASS layout '+width+'x'+height);
  }
  await page.setViewportSize({width:1440,height:900});await page.goto(base+'/?sid=x');
  for(const type of ['swing','pitch']){
   await page.locator(`.gf-home-actions a[href*="type=${type}"]`).click();
   const frame=await(await page.locator('#menu-flow-frame').elementHandle()).contentFrame();
   await frame.waitForFunction(t=>document.querySelector('#filter_type')?.value===t,type);
   await page.locator('#menu-flow-close').click();console.log('PASS existing '+type+' opens filtered Library');
  }
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
