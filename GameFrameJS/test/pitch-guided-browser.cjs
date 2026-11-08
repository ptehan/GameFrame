const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nunjucks = require('nunjucks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'..');
const env = nunjucks.configure(path.join(root,'templates'),{autoescape:true});
env.addFilter('tojson',v=>new nunjucks.runtime.SafeString(JSON.stringify(v ?? null)));
const output = fs.mkdtempSync(path.join(os.tmpdir(),'gf-pitch-guided-'));
(async()=>{
 const browser = await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const [width,known] of [[1440,false],[390,true]]) {
   const page=await browser.newPage({viewport:{width,height:844}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   let html=env.render('upload_pitch_trim.html',{sid:'test',temp_id:'fixture',preset_contact_frame:119,has_preset_contact:known,pending_pitch_id:known?1:0,return_url:'/done',description:'Test pitch'});
   html=html.replace('loadVideo().catch(', 'Promise.resolve().catch(');
   const saved=[];
   await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
    if(url.pathname==='/done')return route.fulfill({contentType:'text/html',body:'Saved'});
    if(url.pathname.startsWith('/static/')){const f=path.join(root,url.pathname);if(fs.existsSync(f))return route.fulfill({path:f});}
    if(url.pathname==='/upload/pitch/finalize'){
     saved.push(route.request().postData());
     if(saved.length===1)return route.fulfill({status:500,body:'Test retry'});
     return route.fulfill({contentType:'application/json',body:JSON.stringify({speed_url:'/done'})});
    }
    return route.fulfill({body:''});
   });
   await page.goto('http://pitch.test/fixture');
   await page.evaluate(known=>{
    const c=document.createElement('canvas');c.width=640;c.height=360;
    const g=c.getContext('2d');g.fillStyle='#379b68';g.fillRect(0,0,640,360);g.fillStyle='white';g.fillRect(300,20,30,300);
    frames=Array(150).fill(c);fps=known?60:30;contactFrame=known?119:0;slider.max=149;slider.value=known?119:0;
    frameModalOpen=true;frameModal.style.display='flex';renderPitchStep();
   },known);
   assert.equal(await page.locator('#pitch_step_title').innerText(),'Set Crop');
   const help=page.locator('#frame_modal .gf-step-help');
   await help.locator('summary').click();
   const helpBounds=await help.locator('.gf-step-help-content').boundingBox();
   assert.ok(helpBounds.width>100 && helpBounds.y+helpBounds.height<=844);
   const helpConfirm=await page.locator('#pitch_step_confirm').boundingBox();
   assert.ok(helpConfirm.y+helpConfirm.height<=844);
   await page.screenshot({path:path.join(output,`help-${width}.png`)});
   await help.locator('summary').click();
   assert.equal(await page.locator('#frame_modal_slider').isVisible(),true);
   const fullscreen=page.locator('#frame_modal .tagging-fullscreen-button');
   await fullscreen.click();
   assert.equal(await page.locator('#frame_modal_prev_btn').isVisible(),true);
   assert.equal(await page.locator('#frame_modal_slider').isVisible(),true);
   await page.screenshot({path:path.join(output,`fullscreen-${width}.png`)});
   await fullscreen.click();
   await page.locator('#pitch_modal_description').fill('Drag crop test');
   const b=await page.locator('#frame_modal_canvas').boundingBox();
   await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width*.6,b.y+b.height/2);await page.mouse.up();
   assert.ok(Number(await page.locator('#portrait_crop_x').inputValue())>.55);
   await page.screenshot({path:path.join(output,`crop-${width}.png`)});
   await page.locator('#pitch_step_confirm').click();
   if(!known){
    assert.equal(await page.locator('#pitch_step_title').innerText(),'Set Pitch Contact Frame');
    assert.equal(await page.locator('#portrait_crop_zoom').isVisible(),false);
    await page.locator('#pitch_step_confirm').click();
    assert.match(await page.locator('#frame_modal_status').innerText(),/after the beginning/);
    await page.evaluate(()=>{slider.value=119;drawFrame(119);});
    await page.screenshot({path:path.join(output,`contact-${width}.png`)});
    await page.locator('#pitch_step_confirm').click();
   }
   await page.waitForFunction(()=>!pitchStepBusy);
   assert.match(await page.locator('#frame_modal_status').innerText(),/Test retry/);
   const button=await page.locator('#pitch_step_confirm').boundingBox();assert.ok(button.y+button.height<=844);
   await page.locator('#pitch_step_confirm').click();await page.waitForURL('**/done');
   assert.equal(saved.length,2);assert.match(saved[1],/Drag crop test/);assert.match(saved[1],/name="contact_frame"\r\n\r\n119/);
   assert.deepEqual(errors,[]);await page.close();
  }
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let frameImage='';
  let html=env.render('pitch_release_test.html',{integration:{id:1,continue_url:'/library'},pitches:[{id:1,contact_frame:119,fps:60,description:'Test',pitcher_name:'Test'}]});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:html});
   if(url.pathname==='/api/pitch-release/preview')return route.fulfill({contentType:'application/json',body:JSON.stringify({selection:{start:88,end:91},contact_frame:119,timing_fps:60,settings:{pitching_feet:60.5,search_extension_feet:6,search_contact_feet:3},review_frames:[88,89,90,91].map(frame=>({frame,image:frameImage}))})});
   if(url.pathname.startsWith('/static/')){const f=path.join(root,url.pathname);if(fs.existsSync(f))return route.fulfill({path:f});}
   return route.fulfill({body:''});
  });
  await page.goto('http://pitch.test/fixture');
  await page.evaluate(()=>document.body.classList.add('embedded-page'));
  assert.equal(await page.locator('#pv-step-title').isVisible(),true);
  assert.ok((await page.locator('#pv-step-title').boundingBox()).width>100);
  assert.equal(await page.locator('#pv-save').isVisible(),false);
  assert.equal(await page.locator('[name=search_extension_feet]').isVisible(),false);
  assert.equal(await page.locator('[name=speed_range]').isVisible(),true);
  await page.screenshot({path:path.join(output,'speed-setup-mobile.png')});
  frameImage=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=180;c.height=320;const g=c.getContext('2d');g.fillStyle='#379b68';g.fillRect(0,0,180,320);return c.toDataURL();});
  await page.locator('#pv-preview').click();
  await page.locator('#pv-picker .tagging-fullscreen-button').click();
  assert.equal(await page.locator('#pv-timeline').isVisible(),true);
  assert.equal(await page.locator('#pv-frame-next').isVisible(),true);
  await page.screenshot({path:path.join(output,'release-fullscreen-mobile.png')});
  await page.locator('#pv-picker .tagging-fullscreen-button').click();
  await page.locator('#pv-select-half').click();
  await page.locator('#pv-confirm-release').click();
  assert.equal(await page.locator('#pv-step-title').innerText(),'Review Pitch Speed');
  assert.ok((await page.locator('#pv-step-title').boundingBox()).height>20);
  assert.equal(await page.locator('#pv-step-title').isVisible(),true);
  assert.equal(await page.locator('[name=speed_range]').isVisible(),false);
  assert.equal(await page.locator('#pv-save').isVisible(),true);
  const original=await page.locator('#pv-speed').innerText();
  await page.locator('[name=search_extension_feet]').fill('7');
  assert.notEqual(await page.locator('#pv-speed').innerText(),original);
  await page.screenshot({path:path.join(output,'speed-review-mobile.png')});
  await page.locator('#pv-change-setup').click();
  assert.equal(await page.locator('#pv-save').isVisible(),false);
  html=env.render('upload_pitch.html',{sid:'test',teams:[{id:1,name:'Test Team'}],pitchers:[{id:1,team_id:1,name:'Test Pitcher'}],request:{query_params:{}}});
  await page.goto('http://pitch.test/fixture');
  assert.equal(await page.locator('#team_select').isVisible(),false);
  await page.locator('#file_input').setInputFiles({name:'test.mp4',mimeType:'video/mp4',buffer:Buffer.from('fixture')});
  await page.locator('#pitch_upload_next').click();
  assert.equal(await page.locator('#pitch_upload_title').innerText(),'Select Team and Pitcher');
  await page.locator('#team_select').selectOption('1');
  await page.locator('#pitcher_select').selectOption('1');
  await page.locator('#pitch_upload_next').click();
  assert.equal(await page.locator('#video_upload_submit').isVisible(),true);
  assert.equal(await page.locator('#team_select').isVisible(),false);
  await page.locator('#pitch_upload_back').click();
  assert.equal(await page.locator('#pitcher_select').inputValue(),'1');
  await page.close();
  console.log('PASS: pitch crop/contact, known contact skip, save retry/payload/redirect, speed setup, desktop/mobile. Screenshots: '+output);
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
