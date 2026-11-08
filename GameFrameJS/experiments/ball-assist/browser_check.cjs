const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'demo-output/ball-assist-lab/browser-qa');fs.mkdirSync(OUT,{recursive:true});
const reference=JSON.parse(fs.readFileSync(path.join(ROOT,'demo-output/ball-assist-lab/references.json'))).find(r=>r.hit_id===86);
const base='http://127.0.0.1:8017';
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(base+'/batch.html');await page.waitForFunction(()=>typeof session!=='undefined'&&session&&!busy,null,{timeout:120000});
  await page.locator('#examples').selectOption('recent');await page.waitForFunction(()=>session?.name==='Adam hit'&&!busy,null,{timeout:120000});
  const meta=await page.evaluate(()=>({id:session.id,width:session.width,height:session.height,times:session.times}));
  const seeds=reference.manual_points.filter(p=>p.relative_s>0).slice(0,2);
  async function select(frame){await page.locator('#scrub').evaluate((e,value)=>{e.value=value;e.dispatchEvent(new Event('input'));},String(frame));await page.waitForFunction(f=>image?.src.endsWith('/frame/'+f),frame);}
  async function click(x,y){const box=await page.locator('#frame').boundingBox();await page.mouse.click(box.x+x/reference.width*box.width,box.y+y/reference.height*box.height);}
  for(const seed of seeds){let frame=0;meta.times.forEach((t,i)=>{if(Math.abs(t-seed.time_s)<Math.abs(meta.times[frame]-seed.time_s))frame=i;});await select(frame);await click(seed.x,seed.y);}
  assert.equal(await page.locator('#counts').textContent(),'2 reviewed');
  const exported=()=>page.evaluate(async()=>JSON.parse(await (await fetch(document.getElementById('export').href)).text()));
  assert.equal((await exported()).points.length,2);
  await page.locator('#action').click();await page.waitForFunction(()=>!busy&&suggestions.length>0,null,{timeout:70000});
  const suggestionCount=await page.locator('#strip button').count();assert.ok(suggestionCount>0);
  assert.equal((await exported()).points.length,2,'Unreviewed suggestions must not be exported.');
  const layouts=[];
  for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:1024,height:768},{width:390,height:844}]){
   await page.setViewportSize(viewport);await page.waitForTimeout(120);
   const layout=await page.evaluate(()=>({bodyOverflow:document.documentElement.scrollHeight>innerHeight+1,asideOverflow:document.querySelector('aside').scrollHeight>document.querySelector('aside').clientHeight+1,actionBottom:document.getElementById('action').getBoundingClientRect().bottom,height:innerHeight}));
   layouts.push({viewport,...layout});await page.screenshot({path:path.join(OUT,`review-${viewport.width}x${viewport.height}.png`)});
   assert.equal(layout.bodyOverflow,false,'Page overflow at '+viewport.width);assert.equal(layout.asideOverflow,false,'Sidebar overflow at '+viewport.width);assert.ok(layout.actionBottom<=layout.height,'Review action is offscreen.');
  }
  await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(100);
  const correction=await page.evaluate(()=>({x:pointAt().x+1,y:pointAt().y+1}));await click(correction.x,correction.y);
  assert.equal((await exported()).points.length,3,'Correction is reviewed, other suggestions remain pending.');
  await page.locator('#action').click();assert.equal((await exported()).points.length,2+suggestionCount);
  const sources=new Set((await exported()).points.map(p=>p.source));assert.ok(sources.has('HUMAN_REVIEWED_ASSIST'));
  await page.locator('#skip').click();const afterSkip=await exported();assert.ok(afterSkip.not_visible_frames.length===1);
  assert.equal(afterSkip.points.length,1+suggestionCount);
  const health=await (await fetch(base+'/api/health')).json();assert.equal(health.production_database_opened,false);
  const invalid=await fetch(base+'/api/track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session:meta.id,anchors:[{frame:0,x:-2,y:5}]})});assert.equal(invalid.status,400);
  const origin=await fetch(base+'/api/track',{method:'POST',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:'{}'});assert.equal(origin.status,403);
  assert.equal((await fetch(base+'/server.cjs')).status,404);assert.equal((await fetch(base+'/tracker.py')).status,404);
  assert.equal((await fetch(base+`/api/session/${meta.id}/frame/-1`)).status,404);
  await page.locator('#reset').click();assert.equal(await page.locator('#counts').textContent(),'0 reviewed');assert.equal(await page.locator('#export').isVisible(),false);assert.equal(await page.locator('#action').isDisabled(),true);
  const before=Number(await page.locator('#scrub').inputValue());await page.locator('#stage').focus();await page.keyboard.press('ArrowRight');assert.equal(Number(await page.locator('#scrub').inputValue()),before+1);
  const box=await page.locator('#frame').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.wheel(0,-100);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  const zoomMark=(await exported()).points[0];assert.ok(Math.abs(zoomMark.image_x-meta.width/2)<1.5&&Math.abs(zoomMark.image_y-meta.height/2)<1.5,'Zoomed click must keep source pixel coordinates.');await page.locator('#reset').click();
  assert.deepEqual(errors,[]);
  const result={passed:true,suggestionsReviewed:suggestionCount,unreviewedExportExcluded:true,acceptCorrectSkipReset:true,zoomCoordinates:true,localBoundaryChecks:true,layouts,browserErrors:errors};
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }catch(error){await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});const diagnostic=await page.evaluate(()=>({status:document.getElementById('status')?.textContent,loading:document.getElementById('loading')?.textContent,index:typeof index==='undefined'?null:index,busy:typeof busy==='undefined'?null:busy,image:typeof image==='undefined'?null:image?.src,session:typeof session==='undefined'?null:session?.id})).catch(()=>({}));console.error(JSON.stringify({diagnostic,browserErrors:errors}));throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

