const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'gf-embedded-layout-'));process.env.DB_PATH=path.join(temp,'test.db');
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport,serviceWorkers:'block'});
   for(const route of ['/multi-swing','/upload/pitch','/matchup/select']){
    await page.goto(`http://127.0.0.1:${server.address().port}${route}?sid=x&embedded=1`,{waitUntil:'networkidle'});
    const bounds=await page.locator('#main').evaluate(e=>({height:e.clientHeight,top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom,overflow:e.scrollHeight-e.clientHeight,doc:document.documentElement.scrollHeight}));
    assert.ok(bounds.height>300,`${route} needs a definite workspace height`);
    assert.ok(bounds.top>=0&&bounds.bottom<=viewport.height+1,`${route} workspace must fit`);
    assert.ok(bounds.doc<=viewport.height+1&&bounds.overflow<=2,`${route} must not clip vertically`);
    await page.screenshot({path:path.join(temp,viewport.width+'-'+route.slice(1).replaceAll('/','-')+'.png'),timeout:5000});
   }
   await page.close();
  }
  console.log('PASS embedded pitch, swing, and matchup height/rendering on desktop and phone.');
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
