const assert=require('node:assert/strict'),express=require('express'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..'),Database=require('better-sqlite3');
const {install,available}=require('./app-integration.cjs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const database=path.join(root,'app.db'),hash=()=>crypto.createHash('sha256').update(fs.readFileSync(database)).digest('hex'),before=hash();
 const db=new Database(database,{readonly:true,fileMustExist:true}),app=express();app.use(express.json());let reads=0;
 install(app,id=>{reads++;return db.prepare('SELECT source_file_name,contact_time_s,clip_start_time_s,clip_blob FROM ev_hit_tracks WHERE id=?').get(id);});
 app.get('/unchanged',(_,res)=>res.send('normal route'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;let browser;
 try{
  assert.equal(available({hostname:'localhost',socket:{remoteAddress:'192.168.1.2'}}),false);
  assert.equal((await fetch(base+'/test/ball-assist',{redirect:'manual'})).status,303);
  assert.equal((await fetch(base+'/test/ball-assist/api/from-hit/73',{method:'POST',headers:{origin:'https://other.example'}})).status,403);assert.equal(reads,0);
  assert.equal((await fetch(base+'/test/ball-assist/api/from-hit/999999',{method:'POST'})).status,404);
  assert.equal(await(await fetch(base+'/unchanged')).text(),'normal route');
  browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
  await page.goto(base+'/test/ball-assist/?hit=73');
  await page.waitForFunction(()=>document.getElementById('status').textContent.includes('frames loaded'),{},{timeout:120000});
  assert.match(await page.locator('#status').textContent(),/InShot_20260704_065621235/);
  assert.equal(await page.locator('#return-app').isVisible(),true);
  assert.equal(await page.locator('#export').isVisible(),false);
  assert.equal(requests.some(r=>new URL(r.url).pathname.startsWith('/api/')),false,'Mounted UI must not use production API paths');
  const sessionResponse=await page.request.get(base+'/test/ball-assist/api/health');assert.equal((await sessionResponse.json()).production_database_opened,false);
  const report={passed:true,source_hit:73,automatic_database_writes:false,errors,requests:requests.filter(r=>r.method!=='GET'),production_database_unchanged:hash()===before};
  assert.deepEqual(errors,[]);assert.equal(report.production_database_unchanged,true);
  const out=path.join(root,'demo-output/ball-assist-lab');await page.screenshot({path:path.join(out,'in-app-test.png')});fs.writeFileSync(path.join(out,'app-integration-check.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));db.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
