const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'demo-output/instruction-continuous',process.env.INSTRUCTION_MENU_TAKE||'current-menu');
const pause=ms=>new Promise(r=>setTimeout(r,ms));fs.mkdirSync(folder,{recursive:true});
(async()=>{
 const dbfile=path.join(folder,'tutorial.db');
 if(!fs.existsSync(dbfile)){const original=new Database(path.join(root,'app.db'),{readonly:true});await original.backup(dbfile);original.close();}
 const check=new Database(dbfile,{readonly:true});const row=check.prepare('SELECT generated_clip_blob FROM ev_hit_tracks WHERE id=102').get();check.close();
 const source=path.join(root,'demo-output/gameframe-20261106/assets/saved-ev.mp4');
 const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
 if(!row?.generated_clip_blob||digest(row.generated_clip_blob)!==digest(fs.readFileSync(source)))throw Error('Saved EV movie does not match selected library video.');
 let server=null,closeDatabase=()=>{},base=process.env.INSTRUCTION_LIVE_BASE;
 if(!base){process.env.DB_PATH=dbfile;process.env.GAMEFRAME_PREWARM_EV='0';const api=require('../server');closeDatabase=api.closeDatabase;server=api.startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));base='http://127.0.0.1:'+server.address().port;}
 else {const response=await fetch(base+'/stream/ev-clip?id=102&kind=generated&inline=1');if(!response.ok||digest(Buffer.from(await response.arrayBuffer()))!==digest(fs.readFileSync(source)))throw Error('Live saved EV movie differs from the full playback asset.');}
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});
 const context=await browser.newContext({viewport:{width:1200,height:900},serviceWorkers:'block',recordVideo:{dir:folder,size:{width:1200,height:900}}});
 await context.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{const c=document.createElement('div');c.style.cssText='position:fixed;left:-50px;top:-50px;width:12px;height:12px;background:#0a716b;border:2px solid white;border-radius:50%;pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%)';document.body.append(c);addEventListener('pointermove',e=>{const d=document.querySelector('dialog[open]:not(.ev-dialog-inactive)')||document.body;if(c.parentElement!==d)d.append(c);c.style.left=e.clientX+'px';c.style.top=e.clientY+'px'},true)}));
 const page=await context.newPage();page.setDefaultTimeout(120000);const start=Date.now(),events=[],errors=[];
 const checkpoint=async label=>{events.push({label,seconds:(Date.now()-start)/1000});await page.screenshot({path:path.join(folder,label+'.png')});fs.writeFileSync(path.join(folder,'events.json'),JSON.stringify({base,events,errors},null,2));console.log(label);};
 const click=async el=>{await el.waitFor({state:'visible'});const b=await el.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:24});await pause(300);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await pause(450)};
 try{
  await page.goto(base+'/');await page.locator('[data-ev-start]').waitFor({state:'visible'});await checkpoint('current-home');await pause(7500);
  await click(page.locator('[data-ev-start]'));await page.locator('#ev-choose-video').waitFor({state:'visible'});await checkpoint('current-choose-video');await pause(1000);
  const choose=page.waitForEvent('filechooser');await click(page.locator('#ev-choose-video'));await(await choose).setFiles(JSON.parse(fs.readFileSync(path.join(root,'demo-output/gameframe-20261106/session.json'))).source_path);
  const frame=page.frameLocator('#menu-flow-frame');await frame.locator('#ev-people-modal').waitFor({state:'visible'});await checkpoint('current-people');await frame.locator('#gameframe-team').selectOption('20');await pause(900);await frame.locator('#gameframe-hitter').selectOption('8');await frame.locator('#actual-field-map-modal').waitFor({state:'visible'});await checkpoint('current-field-address');await pause(2000);
  await page.goto(base+'/');await page.locator('[data-modal-title="Saved videos"]').waitFor({state:'visible'});await checkpoint('current-home-before-library');await pause(1200);await click(page.locator('[data-modal-title="Saved videos"]'));
  const library=page.frameLocator('#menu-flow-frame');await library.locator('#filter_type').waitFor({state:'visible'});await library.locator('#filter_type').selectOption('ev');await library.locator('[data-ev-play="102"]').waitFor({state:'attached'});await click(library.locator('details').filter({has:library.locator('[data-ev-play="102"]')}).locator('summary'));await checkpoint('current-saved-ev-videos');await pause(6500);
  await click(library.locator('[data-ev-play="102"]'));await library.locator('#ev-library-player').waitFor({state:'visible'});await checkpoint('current-ev-player');await pause(700);
 }catch(e){errors.push(String(e));await checkpoint('failure');throw e;}
 finally{
  fs.writeFileSync(path.join(folder,'events.json'),JSON.stringify({base,events,errors,saved_ev_id:102,source_sha256:digest(fs.readFileSync(source)),basis:'Fresh current canonical app, home-button entry, embedded EV workflow, and saved EV library.'},null,2));
  await context.close();const raw=fs.readdirSync(folder).find(n=>n.startsWith('page@')&&n.endsWith('.webm'));if(raw)fs.copyFileSync(path.join(folder,raw),path.join(folder,'current-menu.webm'));
  await browser.close();if(server)await new Promise(r=>server.close(r));closeDatabase();console.log('Current menu recording fully flushed; live app left running.');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
