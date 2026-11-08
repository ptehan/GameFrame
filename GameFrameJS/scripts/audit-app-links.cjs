// Crawl navigational GET links using a small isolated copy of library fixtures.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),Database=require('better-sqlite3');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'gf-link-audit-'));
 process.env.DB_PATH=path.join(temporary,'audit.db');
 const {startServer,closeDatabase}=require('../server');const server=startServer(0,'127.0.0.1');
 await new Promise(r=>server.listening?r():server.once('listening',r));
 const source=new Database(path.join(root,'app.db'),{readonly:true}),fixture=new Database(process.env.DB_PATH),ids={};
 fixture.pragma('foreign_keys = OFF');
 for(const table of ['teams','hitters','pitchers','pitch_clips','swing_clips','matchups','ev_hit_tracks','pending_swing_clips','pending_pitch_clips']){
  const schema=source.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;if(!schema)continue;
  fixture.exec(schema.replace(/^CREATE TABLE/i,'CREATE TABLE IF NOT EXISTS'));
  const columns=new Set(fixture.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));
  const rows=source.prepare(`SELECT * FROM ${table}${['teams','hitters','pitchers'].includes(table)?'':' ORDER BY id DESC LIMIT 1'}`).all();
  for(const row of rows){const keys=Object.keys(row).filter(k=>columns.has(k));fixture.prepare(`INSERT OR REPLACE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...keys.map(k=>row[k]));ids[table]=row.id;}
 }
 const latestPrediction=source.prepare('SELECT observation_package_json,prediction_json FROM ev_hit_tracks ORDER BY id DESC LIMIT 1').get();
 source.close();fixture.close();
 const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const report={pages:[],links:[],resources:[],errors:[],emptyDisclosures:[],externalLinks:[],explanations:[]};
 const queue=['/','/teams','/hitters','/pitchers','/library','/library?type=ev','/library?type=pitch','/library?type=swing','/library?type=matchup','/dashboard/player','/dashboard/measurements?view=pitching','/dashboard/measurements?view=hitting','/upload/pitch','/upload/swing','/multi-swing','/multi-pitch','/matchup/select','/external_video','/pitch-release-test','/privacy','/terms','/settings/data','/getting-started','/account','/auth/login','/ev/predictor.html'];
 for(const [table,route] of [['pitch_clips','/play/pitch'],['swing_clips','/play/swing'],['matchups','/play/matchup'],['ev_hit_tracks','/play/ev'],['pitch_clips','/pitch/speed'],['pending_swing_clips','/multi-swing/pending/tag'],['pending_pitch_clips','/multi-pitch/pending/tag']])if(ids[table])queue.push(`${route}?id=${ids[table]}`);
 const visited=new Set(),checked=new Set(),assets=new Set();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();
  page.on('pageerror',e=>report.errors.push({page:page.url(),error:e.message}));
  for(let cursor=0;cursor<queue.length&&cursor<80;cursor++){
   const url=new URL(queue[cursor],base);url.searchParams.set('sid','link-audit');const key=url.pathname+url.search;
   if(visited.has(key))continue;visited.add(key);
   try{
    const response=await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(200);
    report.pages.push({url:key,status:response.status(),title:await page.title()});
    console.log('Checked',cursor+1,key,response.status());
    const inventory=await page.evaluate(()=>({links:[...document.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),text:a.textContent.trim(),download:a.hasAttribute('download')})),resources:[...document.querySelectorAll('script[src],link[rel="stylesheet"][href],img[src]')].map(e=>e.src||e.href),empty:[...document.querySelectorAll('details')].filter(d=>{const body=d.cloneNode(true);body.querySelector('summary')?.remove();return !body.textContent.trim()&&!body.querySelector('input,select,video,canvas,img,button')}).map(d=>d.querySelector('summary')?.textContent.trim())}));
    inventory.empty.forEach(label=>report.emptyDisclosures.push({page:key,label}));
    for(const link of inventory.links){
     if(!link.href||link.href==='#'||/^(javascript:|mailto:|tel:|blob:|data:)/i.test(link.href))continue;
     const target=new URL(link.href,page.url());
     if(target.origin!==base){report.externalLinks.push({page:key,...link});continue;}
     if(target.hash&&target.pathname===new URL(page.url()).pathname&&target.search===new URL(page.url()).search){const exists=await page.evaluate(hash=>!!document.getElementById(decodeURIComponent(hash.slice(1))),target.hash);if(!exists)report.links.push({from:key,to:target.pathname+target.hash,status:'missing_fragment'});continue;}
     target.hash='';target.searchParams.set('sid','link-audit');const targetKey=target.pathname+target.search;
     if(checked.has(targetKey))continue;checked.add(targetKey);
     // Backup generation is an operation rather than a page navigation.
     if(target.pathname==='/settings/data/backup')continue;
     try{const result=await context.request.get(target.href,{timeout:20000});const type=result.headers()['content-type']||'';report.links.push({from:key,to:targetKey,status:result.status(),type});if(result.ok()&&type.includes('text/html')&&!visited.has(targetKey)&&!target.pathname.startsWith('/api/')&&target.pathname!=='/matchup/build')queue.push(targetKey);}
     catch(error){report.links.push({from:key,to:targetKey,status:'request_error',error:error.message});}
    }
    for(const resource of inventory.resources){const target=new URL(resource,page.url());if(target.origin!==base||assets.has(target.href))continue;assets.add(target.href);try{const result=await context.request.get(target.href,{timeout:20000});report.resources.push({url:target.pathname,status:result.status()});}catch(error){report.resources.push({url:target.pathname,status:'request_error',error:error.message});}}
   }catch(error){report.pages.push({url:key,status:'page_error',error:error.message});}
  }
  const output=path.join(root,'demo-output/link-audit');fs.mkdirSync(output,{recursive:true});
  fs.writeFileSync(path.join(output,'navigation-report.json'),JSON.stringify(report,null,2));
  // Exercise the actual EV review disclosure with saved and current fitting methods.
  await page.goto(base+'/ev/predictor.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof measurementSupportMarkup==='function');
  const saved=JSON.parse(latestPrediction.prediction_json||'{}');
  const cases=[['saved',saved],['angle_primary',{measurement_support:{exit_velocity_mph:[80,90],launch_angle_deg:[20,25]},direction_first_match:{angle_primary:true,late_evidence_policy:'timing_only',best:{exit_velocity_mph:85,launch_angle_deg:23,score_policy:'fixed_launch_then_spray_speed_and_distance'}}}],['older_without_best',{measurement_support:{exit_velocity_mph:[80,90],launch_angle_deg:[20,25]}}]];
  for(const [name,prediction] of cases){
   await page.evaluate(({prediction,pkg})=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());loadPackageIntoState(pkg);state.latestPrediction=prediction;estimateExplanationOpen=false;renderWorkflowStep('player');els.setupModal.showModal();},{prediction,pkg:JSON.parse(latestPrediction.observation_package_json)});
   const summary=page.locator('#workflow-estimate-toggle');await summary.click();
   const body=page.locator('.workflow-estimate-explanation-body');assert.equal(await body.isVisible(),true);
   const text=await body.innerText();assert.ok(text.length>150);assert.ok(!/undefined|NaN/.test(text));
   await page.evaluate(()=>renderWorkflowStep('player'));assert.equal(await body.isVisible(),true,'help must stay open when review updates');
   assert.equal(await page.locator('#setup-modal').evaluate(d=>d.open),true);assert.equal(new URL(page.url()).pathname,'/ev/predictor.html');
   report.explanations.push({case:name,characters:text.length,passed:true});
  }
  await page.screenshot({path:path.join(output,'estimate-explanation.png')});
  for(const entry of report.pages){
   if(entry.url.startsWith('/settings/data?')&&entry.status===404&&!report.links.some(link=>link.to.startsWith('/settings/data'))){entry.expectedUnavailable='Desktop-only screen, not linked in browser mode';}
  }
  report.failures=[...report.pages,...report.links,...report.resources].filter(r=>!r.expectedUnavailable&&(typeof r.status!=='number'||r.status>=400));
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({pages:report.pages.length,links:report.links.length,resources:report.resources.length,failures:report.failures,emptyDisclosures:report.emptyDisclosures,errors:report.errors,explanations:report.explanations,externalLinks:report.externalLinks.length},null,2));
 }finally{await browser.close();await new Promise(r=>server.close(r));closeDatabase();}
})().catch(e=>{console.error(e);process.exitCode=1});
