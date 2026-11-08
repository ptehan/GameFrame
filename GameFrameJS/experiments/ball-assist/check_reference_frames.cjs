// Reproduce the browser seeking used while marking. This does not change saved marks.
const fs=require('node:fs'),path=require('node:path'),express=require('express');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'demo-output/ball-assist-lab'),references=JSON.parse(fs.readFileSync(path.join(OUT,process.env.CONTACT_REFERENCE||'references.json')));
(async()=>{
 const app=express();app.get('/',(req,res)=>res.send('<!doctype html><video id="v" muted preload="auto" style="width:640px"></video>'));
 app.get('/video/:id',(req,res)=>{const r=references.find(r=>String(r.hit_id)===req.params.id);if(!r)return res.sendStatus(404);res.sendFile(r.video);});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});const page=await browser.newPage();
 const url='http://127.0.0.1:'+server.address().port;const rows=[];
 try{
  await page.goto(url);
  for(const ref of references){
   await page.evaluate(async id=>{const v=document.getElementById('v');await new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=()=>reject(Error('Video decode failed'));v.src='/video/'+id;v.load();});},ref.hit_id);
   for(const point of ref.manual_points){
    const frame=await page.evaluate(time=>new Promise((resolve,reject)=>{
     const v=document.getElementById('v');let handle;const timer=setTimeout(()=>{v.cancelVideoFrameCallback(handle);reject(Error('Frame callback timed out'));},7000);
     const capture=(now,meta)=>{if(Math.abs(meta.mediaTime-time)>.1){handle=v.requestVideoFrameCallback(capture);return;}clearTimeout(timer);resolve({requested_time_s:time,displayed_time_s:meta.mediaTime});};
     handle=v.requestVideoFrameCallback(capture);v.currentTime=time;
    }),point.time_s);
    rows.push({hit_id:ref.hit_id,...frame});
   }
  }
  fs.writeFileSync(path.join(OUT,process.env.CONTACT_ALIGNMENT||'reference-frame-times.json'),JSON.stringify({method:'Native Chrome requestVideoFrameCallback after seeking to the original saved mark timestamp. No detector results or coordinates used to choose a frame.',rows},null,2));console.log(JSON.stringify(rows));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
