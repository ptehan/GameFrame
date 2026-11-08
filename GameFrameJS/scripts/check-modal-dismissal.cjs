const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 process.env.DB_PATH=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'gf-modal-dismissal-')),'test.db');
 const {startServer,closeDatabase}=require('../server');
 const server=startServer(0,'127.0.0.1');await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const reports=[];
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:900},hasTouch:mobile,isMobile:mobile,serviceWorkers:'block'});
   const page=await context.newPage();await page.goto(base+'/?sid=modal-test',{waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>window.GameFrameModalDismissalVersion==='20261102-2');
   for(const kind of ['manage-modal','pose-modal','frame-modal','collage-modal','pitch-entity-modal','entity_modal','role-dialog']){
    await page.evaluate(kind=>{
     const root=document.createElement('div');root.id=kind==='entity_modal'?kind:'dismissal-fixture';
     root.className=kind==='entity_modal'?'':kind;
     if(kind==='role-dialog'){root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');}
     root.style.cssText='display:block;position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.4)';
     root.innerHTML='<div class="modal-backdrop" style="position:absolute;inset:0"><span id="backdrop-child" style="position:absolute;inset:0"></span></div><div class="modal-card" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:260px;height:180px;background:white;z-index:2"><input id="draft-value" value="keep my work"><button id="fixture-forward" type="button">Choose video</button><button id="fixture-close" type="button">Close</button></div>';
     // The inline upload modal normally has an anonymous inner card.
     if(kind==='entity_modal')root.prepend(root.querySelector('.modal-card'));
     document.body.append(root);window.dismissalFixture=root;window.accidentalCloses=0;
     const close=()=>{root.style.display='none';};
     document.getElementById('fixture-close').onclick=close;
     const outside=event=>{if(!root.querySelector('.modal-card').contains(event.target)&&!event.target.closest?.('button,input')){window.accidentalCloses++;close();}};
     root.addEventListener('click',outside);document.addEventListener('click',outside);
     window.fixtureCleanup=()=>{document.removeEventListener('click',outside);root.remove();document.getElementById('outside-file')?.remove();};
     const input=document.createElement('input');input.type='file';input.id='outside-file';input.hidden=true;document.body.append(input);
     window.forwardedActions=0;input.onclick=event=>{event.preventDefault();window.forwardedActions++;};
     document.getElementById('fixture-forward').onclick=()=>input.click();
    },kind);
    await page.waitForTimeout(20);
    if(mobile)await page.touchscreen.tap(10,10);else await page.mouse.click(10,10);
    await page.keyboard.press('Escape');
    // Some outside handlers receive a page target rather than the overlay.
    await page.evaluate(()=>document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})));
    assert.equal(await page.evaluate(()=>getComputedStyle(dismissalFixture).display!=='none'),true,kind+' must stay open');
    assert.equal(await page.evaluate(()=>accidentalCloses),0,kind+' outside handler must not run');
    assert.equal(await page.locator('#draft-value').inputValue(),'keep my work');
    await page.locator('#draft-value').fill('still editable');
    await page.locator('#fixture-forward').click();assert.equal(await page.evaluate(()=>forwardedActions),1,'Forwarded file-picker action must work');
    await page.locator('#fixture-close').click();assert.equal(await page.evaluate(()=>getComputedStyle(dismissalFixture).display),'none','Explicit Close must work');
    await page.evaluate(()=>fixtureCleanup());reports.push({mobile,kind,passed:true});
   }
   await context.close();
  }
  const page=await browser.newPage({viewport:{width:1440,height:900},serviceWorkers:'block'});
  await page.goto(base+'/?sid=modal-test');
  await page.evaluate(()=>{
   for(const id of ['first-test-dialog','second-test-dialog']){
    const d=document.createElement('dialog');d.id=id;d.innerHTML='<button type="button">Close</button>';
    d.querySelector('button').onclick=()=>d.close();document.body.append(d);
   }
   document.getElementById('second-test-dialog').showModal();document.getElementById('first-test-dialog').showModal();
  });
  await page.mouse.click(1,1);await page.keyboard.press('Escape');
  assert.equal(await page.locator('#first-test-dialog').getAttribute('closedby'),'none');
  assert.equal(await page.evaluate(()=>document.getElementById('first-test-dialog').open),true);
  await page.locator('#first-test-dialog button').click();
  assert.equal(await page.evaluate(()=>document.getElementById('second-test-dialog').open),true);
  await page.locator('#second-test-dialog button').click();reports.push({kind:'native reverse opening order',passed:true});
  // Exercise the actual embedded EV wrapper, without loading or saving a hit.
  await page.evaluate(()=>{const m=document.getElementById('menu-flow-modal');m.dataset.flow='ev';document.getElementById('ev-video-start').hidden=true;const f=document.getElementById('menu-flow-frame');f.hidden=false;f.src='/ev/predictor.html';m.showModal();});
  const frameElement=await page.locator('#menu-flow-frame').elementHandle();const frame=await frameElement.contentFrame();
  await frame.waitForFunction(()=>window.GameFrameModalDismissalVersion==='20261102-2'&&window.GameFrameEvDialogs);
  await frame.evaluate(()=>{actualMapStage='points';document.getElementById('setup-modal').showModal();document.getElementById('actual-field-map-modal').showModal();window.draftSentinel='keep EV draft';});
  await frame.waitForFunction(()=>document.getElementById('setup-modal').classList.contains('ev-dialog-inactive'));
  const box=await page.locator('#menu-flow-frame').boundingBox();await page.mouse.click(box.x+2,box.y+2);await page.keyboard.press('Escape');
  await page.mouse.click(1,1);
  assert.equal(await page.evaluate(()=>document.getElementById('menu-flow-modal').open),true,'Outer EV wrapper stays open');
  assert.equal(await frame.evaluate(()=>document.getElementById('actual-field-map-modal').open),true,'Inner EV map stays open');
  assert.equal(await frame.evaluate(()=>draftSentinel),'keep EV draft');
  await frame.locator('#actual-field-map-modal .ev-dialog-close').click();
  await page.waitForFunction(()=>!document.getElementById('menu-flow-modal').open);
  reports.push({kind:'actual nested EV dialogs',passed:true});
  fs.writeFileSync('demo-output/modal-dismissal-check.json',JSON.stringify({passed:true,isolated_database:true,reports},null,2));
  console.log('PASS: '+reports.length+' desktop/mobile/native/nested-EV cases; outside clicks preserve dialogs and Close/file-picker controls work.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));closeDatabase();}
})().catch(error=>{console.error(error);process.exitCode=1;});
