const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const page=await browser.newPage({serviceWorkers:'block'});page.setDefaultTimeout(15000);let fetches=0;
  const base=process.env.GAMEFRAME_TEST_URL||'http://127.0.0.1:8000';
  await page.goto(base+'/',{waitUntil:'domcontentloaded'});
  const jpeg=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=16;c.height=16;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,16,16);return c.toDataURL('image/jpeg').split(',')[1];});
  await page.route('**/api/raw/tag-frames?id=cache-*',route=>{fetches++;return route.fulfill({body:Buffer.from(jpeg,'base64'),headers:{'X-Frame-Count':'1','Content-Type':'application/octet-stream'}});});
  await page.route('**/frame-cache-test',route=>route.fulfill({contentType:'text/html',headers:{'Cross-Origin-Embedder-Policy':'require-corp','Cross-Origin-Resource-Policy':'same-origin'},body:'<script src="/static/js/tag-frames.js?v=20261105-reuse"></script>'}));
  async function frame(){const handle=await page.evaluateHandle(url=>{const el=document.createElement('iframe');el.src=url;document.body.append(el);return el;},base+'/frame-cache-test');const f=await handle.asElement().contentFrame();await f.waitForFunction(()=>typeof loadExactTagFrames==='function',null,{timeout:15000});return {handle,f};}
  const first=await frame();await first.f.evaluate(()=>loadExactTagFrames('cache-a',null,{fps:30,frame_count:1}));assert.equal(fetches,1);
  await first.handle.evaluate(el=>el.remove());
  const second=await frame();
  const pixel=await second.f.evaluate(async()=>{const frames=await loadExactTagFrames('cache-a');const c=document.createElement('canvas');c.width=16;c.height=16;const x=c.getContext('2d');x.drawImage(frames[0],0,0);return [...x.getImageData(0,0,1,1).data];});
  assert.equal(fetches,1,'Reuse must survive replacing the iframe');assert.ok(pixel[0]>220&&pixel[1]<40);
  await second.f.evaluate(()=>loadExactTagFrames('cache-b'));assert.equal(fetches,2);
  console.log('PASS: decoded frame reuse across iframe replacement; distinct source fetches; cached frame pixels remain usable.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
