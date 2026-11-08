// Run explicitly with PLAYWRIGHT_MODULE pointing to an installed Playwright.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const nunjucks = require('nunjucks');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const env = nunjucks.configure(path.join(root, 'templates'), {autoescape:true});
env.addFilter('tojson', value => new nunjucks.runtime.SafeString(JSON.stringify(value ?? null)));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-swing-guided-'));
(async () => {
  const browser = await chromium.launch({channel:'msedge', headless:true});
  try {
    for (const [width, rate, known] of [[1440,30,false],[390,60,true],[1440,59.94,true]]) {
      const page = await browser.newPage({viewport:{width,height:844}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      let html = env.render('upload_swing_trim.html', {sid:'test',temp_id:'fixture',fps:rate,
        preset_contact_frame:119,has_preset_contact:known,pending_id:known?1:0,
        pending_swings:[],pending_count:1,pending_position:0,return_url:'/done',
        description:'Test swing',swing_type:'game',embedded:true});
      // Exercise the real page code with deterministic decoded frames and no DB writes.
      html = html.replace(/loadVideo\(\);\s*setupSmoothScrub\(\);/, 'setupSmoothScrub();');
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/fixture') return route.fulfill({contentType:'text/html',body:html});
        if (url.pathname.startsWith('/static/')) {
          const file = path.join(root,url.pathname);
          if (fs.existsSync(file)) return route.fulfill({path:file});
        }
        return route.fulfill({status:200,body:''});
      });
      await page.goto('http://swing.test/fixture');
      await page.evaluate(({rate,known}) => {
        const f = document.createElement('canvas'); f.width=640;f.height=360;
        const g=f.getContext('2d');g.fillStyle='#379b68';g.fillRect(0,0,640,360);
        g.fillStyle='#fff';g.fillRect(300,40,30,250);
        frames=Array(150).fill(f);fps=rate;contactFrame=known?119:0;
        slider.max=149;slider.value=known?119:0;
        finishSwingAndReturn=id=>{window.saved=true;window.savedSwingId=id;hideFinalizing();};
        window.saveAttempts=[];window.failSave=false;
        window.fetch=async(url,opts)=>{
          window.saveAttempts.push(Object.fromEntries(opts.body.entries()));
          return {ok:!window.failSave,text:async()=> 'Test save failure',json:async()=>({ok:true,swing_id:123})};
        };
        openFrameModal();
      },{rate,known});
      assert.equal(await page.locator('#swing_step_title').innerText(),'Set Crop');
      const help=page.locator('#frame_modal .gf-step-help');
      await help.locator('summary').click();
      const helpBounds=await help.locator('.gf-step-help-content').boundingBox();
      assert.ok(helpBounds.width>100 && helpBounds.y+helpBounds.height<=844);
      const helpConfirm=await page.locator('#swing_step_confirm').boundingBox();
      assert.ok(helpConfirm.y+helpConfirm.height<=844);
      await page.screenshot({path:path.join(output,`help-${width}-${rate}.png`)});
      await help.locator('summary').click();
      assert.equal(await page.locator('#frame_modal_prev_btn').isVisible(),true);
      const fullscreen=page.locator('#frame_modal .tagging-fullscreen-button');
      await fullscreen.click();
      assert.equal(await page.locator('#frame_modal_slider').isVisible(),true);
      assert.equal(await page.locator('#frame_modal_next_btn').isVisible(),true);
      await page.screenshot({path:path.join(output,`fullscreen-${width}-${rate}.png`)});
      await fullscreen.click();
      assert.equal(await page.locator('#portrait_crop_x').isVisible(),false);
      await page.locator('#frame_modal_description').fill('Tagged test');
      await page.locator('#frame_modal_swing_type').selectOption('tee');
      const canvas = await page.locator('#frame_modal_canvas').boundingBox();
      await page.mouse.move(canvas.x+canvas.width/2,canvas.y+canvas.height/2);
      await page.mouse.down();await page.mouse.move(canvas.x+canvas.width*.6,canvas.y+canvas.height/2);await page.mouse.up();
      assert.ok(Number(await page.locator('#portrait_crop_x').inputValue())>.55);
      await page.screenshot({path:path.join(output,`crop-${width}-${rate}.png`)});
      await page.locator('#swing_step_confirm').click();
      if (!known) {
        assert.equal(await page.locator('#frame_modal').getAttribute('data-step'),'contact');
        await page.evaluate(()=>setFrameClamped(119));
        await page.locator('#swing_step_confirm').click();
      }
      const back5=Math.round(5*rate/30),back15=Math.round(15*rate/30);
      assert.equal(await page.locator('#frame_modal').getAttribute('data-step'),'commitment');
      assert.equal(Number(await page.locator('#frame_modal_slider').inputValue()),119-back5);
      assert.equal(await page.locator('#frame_modal_description').isVisible(),false);
      await page.evaluate(()=>setFrameClamped(119));
      await page.locator('#swing_step_confirm').click();
      assert.match(await page.locator('#frame_modal_status').innerText(),/before contact/);
      await page.evaluate(i=>setFrameClamped(i),119-back5);
      await page.locator('#swing_step_confirm').click();
      assert.equal(await page.locator('#frame_modal').getAttribute('data-step'),'start');
      assert.equal(Number(await page.locator('#frame_modal_slider').inputValue()),119-back5-back15);
      const bounds=await page.locator('#swing_step_confirm').boundingBox();
      assert.ok(bounds.y+bounds.height<=844,JSON.stringify(bounds));
      await page.screenshot({path:path.join(output,`start-${width}-${rate}.png`)});
      await page.evaluate(()=>window.failSave=true);
      await page.locator('#swing_step_confirm').click();
      await page.waitForFunction(()=>!swingTagBusy);
      assert.match(await page.locator('#frame_modal_status').innerText(),/Test save failure/);
      await page.evaluate(()=>window.failSave=false);
      await page.locator('#swing_step_confirm').click();
      await page.waitForFunction(()=>window.saved);
      assert.equal(await page.evaluate(()=>window.savedSwingId),123);
      const attempts=await page.evaluate(()=>window.saveAttempts);
      assert.equal(attempts.length,2);
      assert.equal(Number(attempts[1].start_frame),119-back5-back15);
      assert.equal(Number(attempts[1].decision_frame_source),119-back5);
      assert.equal(Number(attempts[1].contact_frame),119);
      assert.equal(attempts[1].description,'Tagged test');
      assert.equal(attempts[1].swing_type,'tee');
      assert.ok(JSON.parse(attempts[1].portrait_crop).x>0.3);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log(`PASS: guided swing crop, frame ordering, 30/60/59.94 fps, preset contact, save retry, desktop/mobile. Screenshots: ${output}`);
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
