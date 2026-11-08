// Diagnostic replay only: reuses saved marks, never saves library data or claims to be a demo.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const reference=require('../demo-output/sources/recording-reference.json');
const packet=JSON.parse(fs.readFileSync(path.resolve(process.argv[3]||'demo-output/ev-recording-1792655034486/observations.json')));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  await page.goto('http://localhost:8000/ev/predictor.html');
  await page.locator('#video-file').setInputFiles(packet.video_metadata.source_path||reference.ev.source);
  await page.waitForFunction(()=>els.video.videoWidth>0&&els.video.readyState>=2);
  const result=await page.evaluate(async packet=>{
   const manual=packet.ball_observations.filter(p=>p.source==='HUMAN');
   state.contactTime=packet.hit.contact.timestamp_s;state.frameStepS=packet.video_metadata.frame_step_assumption_s||1/30;
   state.observations=manual;const scans=[];
   const original=farthestLineStreak;
   farthestLineStreak=(...args)=>{
    const hit=original(...args);scans.push({low:args[7],high:args[8],hit,
     distance_from_upper_bound:hit?args[8]-hit.progress:null});return hit;
   };
   await detectFlightWithManualLineFastPath({contactPoint:manual[0],fiveFramePoint:manual[1]});
   return {scans,observations:state.autoObservations,status:els.autoTrackStatus.textContent};
  },packet);
  const out=path.resolve(process.argv[2]||'demo-output/line-tracker-diagnostic.json');
  fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
