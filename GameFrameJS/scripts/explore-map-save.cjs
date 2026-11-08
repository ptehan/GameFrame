// Isolated browser context; no saved-hit write endpoints are called.
const fs=require('node:fs');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const requests=[];
 page.on('request',r=>{if(r.method()==='POST')requests.push(new URL(r.url()).pathname);});
 try{
  await page.goto('http://127.0.0.1:8000/ev/predictor.html?ev_hit_id=85',{waitUntil:'domcontentloaded',timeout:90000});
  await page.waitForFunction(()=>typeof actualFieldMapState!=='undefined'&&actualFieldMapState.home&&window.html2canvas&&window.L,{},{timeout:90000});
  await page.evaluate(()=>openLandingReview());
  await page.waitForTimeout(1500);
  const result=await page.evaluate(async()=>{
   const stages={};const original=captureActualFieldMapEvidenceImage;
   captureActualFieldMapEvidenceImage=async()=>{const start=performance.now();const image=await original();stages.screenshot_seconds=(performance.now()-start)/1000;stages.image_bytes=image?.length||0;return image;};
   const start=performance.now();const applied=await applyActualFieldMapValues();
   return {applied,total_seconds:(performance.now()-start)/1000,...stages};
  });
  result.post_requests=requests;result.saved_hit_modified=requests.some(p=>p.includes('save-hit'));
  fs.writeFileSync('demo-output/map-save-profile.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
