const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(__dirname,'../../demo-output/ball-assist-lab');
(async()=>{const report=JSON.parse(fs.readFileSync(path.join(out,'cortland-improved-test.json'))),row=report.rows[0];
 assert.equal(row.flight_reference_check_passed,true);const url=`http://127.0.0.1:8017/?session=${row.session}&job=${row.job}`;
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[],posts=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
 try{await page.goto(url);await page.waitForFunction(()=>session&&result&&groundMode&&frameReady&&!busy,null,{timeout:45000});
  assert.equal(await page.evaluate(()=>session.name),'Cortland double');assert.equal(await page.evaluate(()=>index),row.ground_review.frame);assert.equal(await page.evaluate(()=>groundSelection),null);assert.equal(await page.locator('#export').isVisible(),false);assert.equal(posts.length,0,'Reviewing the completed fresh result must not rerun inference or confirm measurements.');
  const layouts=[];for(const size of [{width:1440,height:900},{width:1280,height:720},{width:390,height:844}]){await page.setViewportSize(size);await page.waitForTimeout(200);const layout=await page.evaluate(()=>({pageOverflow:document.documentElement.scrollHeight>innerHeight+1,sideOverflow:document.querySelector('aside').scrollHeight>document.querySelector('aside').clientHeight+1,actionRight:document.getElementById('action').getBoundingClientRect().right,width:innerWidth}));assert.equal(layout.pageOverflow,false);assert.equal(layout.sideOverflow,false);assert.ok(layout.actionRight<=layout.width+1);layouts.push({...size,...layout});await page.screenshot({path:path.join(out,`cortland-ground-review-${size.width}.png`)});}
  assert.deepEqual(errors,[]);const result={passed:true,url,ground_frame:row.ground_review.frame,ground_time_s:await page.evaluate(()=>session.times[index]),unconfirmed:true,noInferenceReuseAsInput:true,layouts,errors};fs.writeFileSync(path.join(out,'real-review-check.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
