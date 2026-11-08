const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const directory=fs.readdirSync(os.tmpdir(),{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.startsWith('gf-link-audit-')).map(e=>path.join(os.tmpdir(),e.name)).filter(p=>fs.existsSync(path.join(p,'audit.db'))).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
 assert.ok(directory,'An isolated audit fixture must exist.');process.env.DB_PATH=path.join(directory,'audit.db');
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));
 const db=new Database(process.env.DB_PATH,{readonly:true});const id=table=>db.prepare(`SELECT id FROM ${table} ORDER BY id DESC LIMIT 1`).get().id;
 const pitch=id('pitch_clips'),swing=id('swing_clips'),matchup=id('matchups'),ev=id('ev_hit_tracks');db.close();
 const base=`http://127.0.0.1:${server.address().port}`,checks=[];
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  for(const route of [`/stream/pitch?id=${pitch}`,`/stream/swing?id=${swing}`,`/stream/matchup?id=${matchup}`,`/api/gameframe/ev-clip?id=${ev}&kind=generated`,`/export/pitch-speed?id=${pitch}`,`/collage/matchup?id=${matchup}&download=1`]){
   const response=await fetch(base+route,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(120000)});assert.ok(response.ok,route+': '+response.status);
   const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>0);
   if(route.startsWith('/collage'))assert.equal(bytes.subarray(0,2).toString('hex'),'ffd8');else assert.equal(bytes.subarray(4,8).toString(),'ftyp',route+' must contain MP4 data');
   checks.push({route,status:response.status,bytes:bytes.length,cache:response.headers.get('x-pitch-export-cache')});
  }
  const page=await browser.newPage({acceptDownloads:true,serviceWorkers:'block'});
  for(const [kind,ident] of [['pitch',pitch],['swing',swing],['matchup',matchup]]){
   await page.goto(base+`/play/${kind}?id=${ident}`,{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('video')?.readyState>=1,{},{timeout:45000});
   const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#download_btn').click()]);
   assert.equal(await download.failure(),null);checks.push({kind,download:download.suggestedFilename(),passed:true});
  }
  // The source-video store belongs to the real app directory. Check the exposed
  // original-pitch link with a read-only HEAD request; no source record is copied.
  const realPage=await(await fetch(`http://127.0.0.1:8000/play/pitch?id=${pitch}`)).text();
  if(realPage.includes(`/original/pitch?id=${pitch}`)){
   const original=await fetch(`http://127.0.0.1:8000/original/pitch?id=${pitch}`,{method:'HEAD'});
   assert.equal(original.status,200);checks.push({route:'/original/pitch',status:original.status,readOnlyHead:true});
  }
  const reportPath=path.resolve('demo-output/link-audit/report.json'),report=JSON.parse(fs.readFileSync(reportPath));
  for(const entry of report.pages)if(entry.url.startsWith('/settings/data?')&&entry.status===404&&!report.links.some(link=>link.to.startsWith('/settings/data')))entry.expectedUnavailable='Desktop-only screen, not linked in browser mode';
  for(const entry of report.links)if(entry.to.startsWith('/export/pitch-speed?')&&entry.status==='request_error'){entry.initialAttempt={status:entry.status,error:entry.error};entry.status=checks.find(c=>c.route.startsWith('/export/pitch-speed?')).status;entry.rechecked=true;delete entry.error;}
  report.mediaChecks=checks;report.failures=[...report.pages,...report.links,...report.resources].filter(r=>!r.expectedUnavailable&&(typeof r.status!=='number'||r.status>=400));
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({mediaChecks:checks,remainingFailures:report.failures},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
