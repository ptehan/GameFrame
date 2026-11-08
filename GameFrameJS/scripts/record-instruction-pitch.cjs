/* Real pitch and matchup tutorial capture. Browser startup requires --record and
 * INSTRUCTION_BROWSER_RELEASE=1. --plan reads metadata only and launches nothing.
 * The original database is opened read-only for SQLite backup into a fresh folder.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const SESSION=path.join(ROOT,'demo-output','instruction-continuous','pitch-session');
const SOURCE=path.join(ROOT,'demo-output','gameframe-20261106','assets','pitch-source.mp4');
const ORIGINAL_DB=path.join(ROOT,'app.db');
const PYTHON=path.join(ROOT,'.venv-ev','Scripts','python.exe');
const NARRATION=path.join(ROOT,'demo-output','instruction-continuous','pitch-narration.json');
const VIEWPORT={width:960,height:720};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const plan={session:SESSION,original_database:ORIGINAL_DB,isolated_database:path.join(SESSION,'tutorial.db'),source:SOURCE,viewport:VIEWPORT,recordVideo:{size:VIEWPORT,native_backend_fps:25},pitch:{team:21,pitcher:39,contact_frame:119,release_frame:92.5,mound_distance:60.5,extension:6,contact_adjustment:3},matchup:{pitch:69,swing:132,team:20,hitter:8,create:false},narration:NARRATION,browser_release_required:true};

function run(binary,args,options={}){
 return new Promise((resolve,reject)=>{
  const child=spawn(binary,args,{cwd:ROOT,windowsHide:true,...options});let stdout='',stderr='';
  child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  child.once('error',reject);child.once('close',code=>code?reject(new Error(stderr||`${binary} exited ${code}`)):resolve(stdout));
 });
}
function write(name,data){fs.writeFileSync(path.join(SESSION,name),JSON.stringify(data,null,2));}
async function snapshot(){
 fs.mkdirSync(SESSION,{recursive:true});const db=plan.isolated_database;
 if(fs.existsSync(db))throw new Error('Refusing to overwrite an existing tutorial.db. Choose a fresh session folder before another take.');
 const python=`import sqlite3,json,pathlib\ns=pathlib.Path(${JSON.stringify(ORIGINAL_DB)})\nt=pathlib.Path(${JSON.stringify(db)})\na=sqlite3.connect(s.as_uri()+'?mode=ro',uri=True)\nb=sqlite3.connect(t)\na.backup(b,pages=512,sleep=.02)\nb.close();a.close()\nc=sqlite3.connect(t.as_uri()+'?mode=ro',uri=True)\nassert c.execute('select count(*) from pitch_clips where id=69').fetchone()[0]==1\nassert c.execute('select count(*) from swing_clips where id=132').fetchone()[0]==1\nassert c.execute('select count(*) from pitchers where id=39 and team_id=21').fetchone()[0]==1\nprint(json.dumps({'pitch69':True,'swing132':True,'pitcher39':True}))\nc.close()`;
 return JSON.parse(await run(PYTHON,['-c',python]));
}
async function startServer(){
 const stdout=fs.createWriteStream(path.join(SESSION,'server.stdout.log'));
 const stderr=fs.createWriteStream(path.join(SESSION,'server.stderr.log'));
 const code=`const a=require(${JSON.stringify(path.join(ROOT,'server.js'))}); const s=a.startServer(0,'127.0.0.1'); process.stdin.setEncoding('utf8'); process.stdin.on('data',data=>{if(data.trim()==='shutdown'){s.close(()=>{a.closeDatabase();process.exit(0);});}}); process.stdin.resume();`;
 const child=spawn(process.execPath,['-e',code],{cwd:ROOT,windowsHide:true,env:{...process.env,DB_PATH:plan.isolated_database,PORT:'0',NODE_ENV:'development',GAMEFRAME_DESKTOP:'0',GAMEFRAME_PREWARM_EV:'0'},stdio:['pipe','pipe','pipe']});
 let output='';const exited=new Promise(resolve=>child.once('exit',code=>{stdout.end();stderr.end();resolve(code);}));
 const ready=new Promise((resolve,reject)=>{
  child.once('error',reject);child.once('exit',code=>reject(new Error('Isolated server exited before ready: '+code)));
  child.stdout.on('data',b=>{stdout.write(b);output+=b;const m=output.match(/listening on http:\/\/localhost:(\d+)/);if(m)resolve('http://127.0.0.1:'+m[1]);});
  child.stderr.on('data',b=>stderr.write(b));
 });
 const base=await ready;write('server.json',{base,pid:child.pid,database:plan.isolated_database,release_file:path.join(SESSION,'server-release.flag')});
 return {child,base,exited,async close(){if(child.exitCode===null)child.stdin.write('shutdown\n');await exited;}};
}

async function main(){
 if(!process.argv.includes('--record')){console.log(JSON.stringify(plan,null,2));return;}
 if(process.env.INSTRUCTION_BROWSER_RELEASE!=='1')throw new Error('Browser has not been released. Set INSTRUCTION_BROWSER_RELEASE=1 only after the parent authorizes this capture.');
 if(!fs.existsSync(SOURCE))throw new Error('Missing verified pitch source: '+SOURCE);
 const bundled='C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright';
 const {chromium}=require(process.env.PLAYWRIGHT_MODULE||(fs.existsSync(bundled)?bundled:'playwright'));
 const reuse=process.env.TUTORIAL_REUSE_SNAPSHOT==='1';
 if(reuse&&(!fs.existsSync(plan.isolated_database)||fs.existsSync(path.join(SESSION,'recording-complete.json'))||fs.existsSync(path.join(SESSION,'recording-raw'))))throw new Error('Snapshot reuse is allowed only before any browser recording has started.');
 const copied=reuse?{reused_untouched_startup_snapshot:true}:await snapshot();write('capture-plan.json',{...plan,snapshot_verification:copied,source_sha256:crypto.createHash('sha256').update(fs.readFileSync(SOURCE)).digest('hex')});
 const server=await startServer();
 const start=Date.now(),events=[],diagnostics=[],checkpoints=[];let browser,context,page,video,error,captureResult={};
 const stamp=(label,extra={})=>{const item={seconds:(Date.now()-start)/1000,label,...extra};events.push(item);write('events.json',events);console.log(JSON.stringify(item));return item;};
 async function checkpoint(name){
  stamp('checkpoint: '+name);if(!page||page.isClosed())return;
  const file=path.join(SESSION,'checkpoints',name+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});
  await page.screenshot({path:file,timeout:60000});
  const state=await page.evaluate(()=>({url:location.href,title:document.querySelector('#pitch_step_title,#pv-step-title,#matchup-step-title,#pitch_upload_title')?.textContent,visibleText:document.body.innerText.slice(0,14000),controls:Array.from(document.querySelectorAll('input,select,button')).filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden').map(el=>({id:el.id,name:el.name,value:el.value,text:el.tagName==='BUTTON'?el.textContent.trim():undefined,disabled:el.disabled}))}));
  const record={name,seconds:(Date.now()-start)/1000,file,state};checkpoints.push(record);write('checkpoints.json',checkpoints);
 }
 async function visible(selectors){
  for(const selector of selectors.split(',')){const candidates=page.locator(selector.trim());for(let i=0;i<await candidates.count();i++){const item=candidates.nth(i);if(await item.isVisible())return item;}}
  const first=page.locator(selectors.split(',').at(-1).trim()).first();await first.waitFor({state:'visible'});return first;
 }
 async function click(selectors,{settle=650}={}){
  const el=await visible(selectors);await el.scrollIntoViewIfNeeded();
  for(let i=0;i<120&&!await el.isEnabled();i++)await pause(250);
  if(!await el.isEnabled())throw new Error('Control remains disabled: '+selectors);
  let b=await el.boundingBox();if(!b)throw new Error('Control has no bounds: '+selectors);
  await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await pause(250);
  b=await el.boundingBox();if(!b)throw new Error('Control redrew without bounds: '+selectors);
  await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await pause(settle);
 }
 async function select(selector,value){
  await page.waitForFunction(({selector,value})=>Array.from(document.querySelector(selector)?.options||[]).some(o=>o.value===String(value)),{selector,value:String(value)});
  await click(selector,{settle:200});await page.keyboard.press('Escape');await page.locator(selector).selectOption(String(value));await pause(650);
 }
 async function type(selector,value){await click(selector,{settle:150});await page.keyboard.press('Control+A');await page.keyboard.type(String(value),{delay:90});await page.keyboard.press('Tab');await pause(500);}
 const confirm='#pitch_step_confirm-top,#pitch_step_confirm';
 try{
  stamp('starting browser: direct recordVideo, no screenshot capture loop');
  browser=await chromium.launch({channel:process.env.TUTORIAL_BROWSER_CHANNEL||'msedge',headless:true,args:['--no-proxy-server']});
  context=await browser.newContext({viewport:VIEWPORT,recordVideo:{dir:path.join(SESSION,'recording-raw'),size:VIEWPORT},serviceWorkers:'block',deviceScaleFactor:1});
  page=await context.newPage();video=page.video();page.setDefaultTimeout(300000);page.setDefaultNavigationTimeout(300000);
  page.on('pageerror',e=>diagnostics.push({type:'pageerror',message:e.message}));
  page.on('requestfailed',r=>diagnostics.push({type:'requestfailed',url:r.url(),failure:r.failure()}));
  page.on('request',r=>{if(r.method()==='POST'){diagnostics.push({type:'post',url:r.url()});if(new URL(r.url()).pathname==='/api/pitch/speed'){const data=r.postDataJSON();captureResult.saved_pitch_id=data.pitch_id;captureResult.speed_save_request=data;}}});
  await page.goto(server.base+'/upload/pitch?sid=x&embedded=1');await checkpoint('01-pitch-upload');await pause(1600);
  stamp('Choose the original pitch video');const chooser=page.waitForEvent('filechooser');await click('label[for="file_input"]');await(await chooser).setFiles(SOURCE);await pause(1200);await checkpoint('02-file-selected');
  await click('#pitch_upload_next');await select('#team_select','21');await select('#pitcher_select','39');await checkpoint('03-team-and-pitcher');await pause(1600);
  await click('#pitch_upload_next');await type('[name=start_min]','0');await type('[name=start_sec]','0');await checkpoint('04-clip-start');await pause(1300);
  stamp('Submit upload and wait for real decoded crop editor');await click('#video_upload_submit');await checkpoint('05-upload-processing');await page.locator('#pitch_modal_description').waitFor({state:'visible'});
  await type('#pitch_modal_description','Instructional pitch walkthrough');await click('#portrait_crop_zoom');await page.keyboard.press('Home');
  await checkpoint('06-crop');await pause(2000);await click(confirm);
  await page.locator('#pitch_step_title').filter({hasText:'Contact'}).waitFor();await click('#frame_modal_slider');
  const max=Number(await page.locator('#frame_modal_slider').getAttribute('max'));
  if(max===119)await page.keyboard.press('End');else{await page.keyboard.press('Home');for(let n=0;n<119;n++)await page.keyboard.press('ArrowRight');}
  captureResult.contact_frame=Number(await page.locator('#frame_modal_slider').inputValue());if(captureResult.contact_frame!==119)throw new Error('Expected contact frame119; got '+captureResult.contact_frame);
  await checkpoint('07-contact-frame-119');await pause(2400);
  stamp('Confirm contact and wait for pitch speed setup');await click(confirm);await page.locator('[name=speed_range]').waitFor({state:'visible'});
  await select('#pv-field','60/90');await select('[name=speed_range]','75-85');await checkpoint('08-distance-and-speed-range');await pause(2000);
  stamp('Prepare real neighboring release frames');await click('#pv-preview');await checkpoint('09-release-processing');await page.locator('#pv-picker').waitFor({state:'visible'});
  async function beforeFrame(){const label=await page.locator('#pv-before-label').innerText();const m=label.match(/\d+/);if(!m)throw new Error('Unrecognized release frame label: '+label);return Number(m[0]);}
  let frame=await beforeFrame(),moves=0;
  while(frame!==92){if(++moves>150)throw new Error('Could not reach release frame92');await click(frame<92?'#pv-frame-next':'#pv-frame-prev',{settle:220});frame=await beforeFrame();}
  await click('#pv-select-half');await checkpoint('10-release-between-92-and-93');await pause(2400);
  const releaseLabel=await page.locator('#pv-release-label').innerText();if(!releaseLabel.includes('92.5'))throw new Error('Expected halfway release92.5: '+releaseLabel);captureResult.release_label=releaseLabel;
  await click('#pv-confirm-release');await type('[name=search_extension_feet]','6');await type('[name=search_contact_feet]','3');await checkpoint('11-review-pitch-speed');
  captureResult.speed_text=await page.locator('#pv-speed').innerText();await pause(2600);
  stamp('Save Speed to Pitch and wait for library');await click('#pv-save');await page.waitForURL('**/library*');await checkpoint('12-saved-pitch-library');await pause(2400);
  stamp('Open actual matchup selection; no duplicate matchup will be created');await page.goto(server.base+'/matchup/select?sid=x&embedded=1');
  await select('#pitch_team','21');await select('#pitch_pitcher','39');await select('#pitch_clip','69');await checkpoint('13-matchup-pitch-69');await pause(2000);
  await click('#matchup-next');await select('#swing_team','20');await select('#swing_hitter','8');await select('#swing_clip','132');await checkpoint('14-matchup-swing-132');await pause(2000);
  await click('#matchup-next');await page.locator('#matchup-create').waitFor({state:'visible'});await checkpoint('15-matchup-review-no-submit');await pause(3300);
  captureResult.matchup={pitch:await page.locator('#pitch_clip').inputValue(),swing:await page.locator('#swing_clip').inputValue(),created:false};
  if(captureResult.matchup.pitch!=='69'||captureResult.matchup.swing!=='132')throw new Error('Wrong saved clips selected');
  stamp('Return to the saved video library');await page.goto(server.base+'/library?type=pitch&sid=x&embedded=1');await checkpoint('16-final-saved-library');await pause(2800);
 }catch(e){error=e;stamp('capture failed',{error:String(e)});try{await checkpoint('failure');}catch(_){} }
 finally{
  write('diagnostics.json',diagnostics);write('result-before-flush.json',{...captureResult,base:server.base,error:error?String(error):null,events,checkpoints});
  stamp('Closing browser context; awaiting the complete native video encoder flush');
  const heartbeat=setInterval(()=>console.log(JSON.stringify({phase:'waiting_for_video_flush',seconds:(Date.now()-start)/1000})),15000);
  try{
   if(context)await context.close();
   if(video){const output=path.join(SESSION,'pitch-matchup-continuous.webm');await video.saveAs(output);captureResult.video=output;captureResult.raw_video=await video.path();}
   if(browser)await browser.close();
  }finally{clearInterval(heartbeat);}
  stamp('Video encoder fully flushed; browser closed');
  write('recording-complete.json',{...captureResult,base:server.base,database:plan.isolated_database,browser_closed:true,encoder_flushed:true,error:error?String(error):null,events,checkpoints,elapsed_seconds:(Date.now()-start)/1000,release_file:path.join(SESSION,'server-release.flag')});
  console.log('PITCH_CAPTURE_COMPLETE_SERVER_READY '+server.base);
  if(process.env.TUTORIAL_KEEP_SERVER==='1'){
   stamp('Keeping isolated server alive for the parent map capture');const release=path.join(SESSION,'server-release.flag');
   while(!fs.existsSync(release)&&server.child.exitCode===null)await pause(1000);
  }
  await server.close();stamp('Isolated server closed gracefully');
 }
 if(error)throw error;
}
module.exports={plan,main};
if(require.main===module)main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
