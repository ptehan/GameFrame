const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const folder=path.resolve(__dirname,'../demo-output/screen-sequence');
const entries=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))).entries;
(async()=>{
 const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(folder,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(folder+path.sep)||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.jpg')?'image/jpeg':'application/json');fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`http://127.0.0.1:${server.address().port}`);
   for(let i=0;i<entries.length;i++){
    assert.equal(await page.locator('#title').innerText(),`${i+1}. ${entries[i].title}`);
    await page.locator('#image').evaluate(e=>e.decode());
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'Gallery must fit vertically');
    if(i<entries.length-1)await page.locator('#next').click();
   }
   await page.locator('#group').selectOption('Measure a hit');
   assert.match(await page.locator('#title').innerText(),/Choose hit video/);
   await page.screenshot({path:path.join(folder,`gallery-preview-${viewport.width}.png`)});
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log(`PASS ${entries.length} ordered, full-resolution screenshots; desktop/phone gallery navigation; no vertical overflow.`);
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
