const express=require('express'),multer=require('multer'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const ROOT=path.resolve(__dirname,'../..'),STORE=path.join(ROOT,'demo-output/ball-assist-lab');
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
const python=process.env.GAMEFRAME_BALL_LAB_PYTHON||path.join(ROOT,'.venv-ev',process.platform==='win32'?'Scripts/python.exe':'bin/python');
let visionWorker=null;const waiting=new Map();
function stopVision(child){if(!child)return;if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else child.kill();}
function startVision(){
 if(visionWorker)return visionWorker;
 const child=spawn(python,['-u',path.join(__dirname,'tracker.py'),'--worker'],{cwd:ROOT,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});visionWorker=child;
 const fail=error=>{if(visionWorker===child)visionWorker=null;for(const [id,p] of waiting){if(p.child!==child)continue;clearTimeout(p.timer);p.reject(error);waiting.delete(id);}};
 require('node:readline').createInterface({input:child.stdout}).on('line',line=>{try{const value=JSON.parse(line),p=waiting.get(value.id);if(!p)return;if(value.progress){p.onProgress?.(value.progress);return;}waiting.delete(value.id);clearTimeout(p.timer);value.error?p.reject(Error(value.error)):p.resolve();}catch{}});
 child.stderr.on('data',b=>console.error(String(b).trim()));child.on('error',fail);child.stdin.on('error',fail);child.on('close',()=>fail(Error('The test tracker stopped. Retry the batch.')));return child;
}
function runTracking(input,output,{mode='batch',job}={}){return new Promise((resolve,reject)=>{const child=startVision(),id=crypto.randomUUID();const timer=setTimeout(()=>{waiting.delete(id);if(visionWorker===child)visionWorker=null;stopVision(child);reject(Error('Detection timed out. Try a shorter clip.'));},mode==='contact'?900000:60000);waiting.set(id,{resolve,reject,timer,child,onProgress:value=>{if(job)job.progress=value;}});if(job)job.cancel=()=>{const pending=waiting.get(id);if(pending){waiting.delete(id);clearTimeout(timer);if(visionWorker===child)visionWorker=null;stopVision(child);reject(Error('Detection cancelled.'));}};child.stdin.write(JSON.stringify({id,input,output,mode})+'\n');});}
function freezeModel(directory){
 fs.mkdirSync(directory,{recursive:true});const files={};
 for(const name of ['tracker.py','contact_scan.py','ground_review.py','bracket_refine.py','frame_source.py','stream_scan.py']){const bytes=fs.readFileSync(path.join(__dirname,name));fs.writeFileSync(path.join(directory,name),bytes);files[name]=crypto.createHash('sha256').update(bytes).digest('hex');}
 const fingerprint=crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),manifest={fingerprint,files};fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));return manifest;
}
const modelWorkers=require('./model-worker.cjs').createModelWorkers({python,root:ROOT,stop:stopVision});
function frozenTrack(directory,input,output,job){return modelWorkers.run(directory,input,output,job);}
function prewarmModel(){const directory=path.join(STORE,'models',crypto.randomUUID());freezeModel(directory);modelWorkers.warm(directory);}
process.once('exit',()=>modelWorkers.stop());
process.once('exit',()=>stopVision(visionWorker));
const EXAMPLES=[{id:'night',name:'Cortland night triple',video:path.join(path.dirname(ROOT),'..','..','Downloads','InShot_20260704_065621235.mp4'),contact:1.993034},{id:'earlier',name:'Cortland double',video:path.join(path.dirname(ROOT),'..','..','Downloads','1000053313.mp4'),contact:2.166644},{id:'recent',name:'Adam hit',video:path.join(path.dirname(ROOT),'..','..','Downloads','Adam 7_10-11_26.mp4'),contact:4}];
// Resolve the user's Downloads from their profile, never by taking a path from a request.
for(const e of EXAMPLES)e.video=path.join(process.env.USERPROFILE||process.env.HOME||ROOT,'Downloads',path.basename(e.video));
fs.mkdirSync(STORE,{recursive:true});const incoming=path.join(STORE,'uploads');fs.mkdirSync(incoming,{recursive:true});
const app=express(),sessions=new Map(),jobs=new Map();let preparing=false;
const upload=multer({dest:incoming,limits:{fileSize:1024*1024*1024,files:1}});
app.use(express.json({limit:'100kb'}));
app.use((req,res,next)=>{
 if(!['127.0.0.1','localhost'].includes(req.hostname))return res.status(403).json({error:'Local test page only.'});
 if(req.method!=='GET'&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Open the test page directly.'});}catch{return res.sendStatus(403);}}
 next();
});
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
function run(binary,args,{timeout=90000,capture=false}={}){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{cwd:ROOT,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('Processing took too long. Try a shorter segment.'));},timeout);child.stdout.on('data',b=>{if(out.length<16e6)out+=b;});child.stderr.on('data',b=>{err=(err+b).slice(capture?-1000000:-12000);});child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(capture?{stdout:out,stderr:err}:out):reject(Error(err||'Processing failed.'));});});}
function jpegDimensions(file){
 const jpeg=fs.readFileSync(file);let imageProbe;
 for(let offset=2;offset+9<jpeg.length;){const marker=jpeg[offset+1],length=jpeg.readUInt16BE(offset+2);if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)){imageProbe={width:jpeg.readUInt16BE(offset+7),height:jpeg.readUInt16BE(offset+5)};break;}if(length<2)break;offset+=length+2;}
 if(!imageProbe)throw Error('Could not read extracted frame dimensions.');return imageProbe;
}
async function prepareFastSampled(video,{start,contact,name,sourceFps}){
 prewarmModel();
 const id=crypto.randomUUID(),dir=path.join(STORE,id),frames=path.join(dir,'frames');fs.mkdirSync(frames,{recursive:true});
 start=Number.isFinite(start)?start:Math.max(0,contact);const frameStride=Math.max(5,Math.round(sourceFps/6)),denseEnd=start+(10+Math.ceil(sourceFps*.4))/sourceFps;
 const decoded=await run(ffmpeg,['-v','info','-nostats','-y','-t',String(start+10),'-threads','2','-i',video,'-an','-vf',`setpts=PTS-STARTPTS,showinfo=checksum=0,select=gte(t\\,${start})*lt(t\\,${start+10})*(lt(t\\,${denseEnd})+not(mod(n\\,${frameStride}))),showinfo=checksum=0,scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,'-frames:v',String(Math.max(100,10+Math.ceil(sourceFps*.4)+60)),'-fps_mode','passthrough','-q:v','3','-threads','2',path.join(frames,'frame-%05d.jpg')],{capture:true});
 const files=fs.readdirSync(frames).filter(f=>/^frame-\d+\.jpg$/.test(f)).sort();
 const timeBase=decoded.stderr.match(/Parsed_showinfo[^\n]*config in time_base:\s*(\d+)\/(\d+)/);
 if(!timeBase||Number(timeBase[2])<=0)throw Error('Could not read exact sampled-frame timestamps.');
 const groups=new Map();for(const m of decoded.stderr.matchAll(/\[(Parsed_showinfo_\d+)[^\]]*\][^\n]*?\bn:\s*(\d+)[^\n]*?\bpts:\s*(-?\d+)/g)){if(!groups.has(m[1]))groups.set(m[1],[]);groups.get(m[1]).push({number:Number(m[2]),pts:Number(m[3])});}
 const [original,sampled]=[...groups.values()];if(!original||!sampled)throw Error('Could not preserve source frame numbering.');
 const byPts=new Map(original.map(row=>[row.pts,row.number]));
 const times=sampled.slice(0,files.length).map(row=>row.pts*Number(timeBase[1])/Number(timeBase[2]));
 const frameNumbers=sampled.slice(0,files.length).map(row=>byPts.get(row.pts));
 const launchFrameCount=times.filter(t=>t<denseEnd-1e-6).length;
 if(files.length<2||times.length!==files.length||times.some(t=>!Number.isFinite(t))||Math.abs(times[0]-start)>2/sourceFps)throw Error('Sampled frame timing could not be matched reliably.');
 const dimensions=jpegDimensions(path.join(frames,files[0]));
 if(frameNumbers.some(n=>!Number.isInteger(n)))throw Error('Source frame numbers could not be matched.');
 const session={id,dir,frames,files,video,name,fps:sourceFps/frameStride,sourceFps,frameStride,launchFrameCount,start,duration:Math.min(10,times.at(-1)-start+frameStride/sourceFps),...dimensions,times,frameNumbers,initialFrame:0,full:true};
 sessions.set(id,session);fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({...publicSession(session),video},null,2));return publicSession(session);
}
async function prepare(video,{start,contact=0,name='Video',full=false,sampled=false,sourceFps}={}){
 if(sampled&&Number.isFinite(sourceFps)&&sourceFps>=5&&sourceFps<=240)return prepareFastSampled(video,{start,contact,name,sourceFps});
 const id=crypto.randomUUID(),dir=path.join(STORE,id),frames=path.join(dir,'frames');fs.mkdirSync(frames,{recursive:true});
 const probeStart=Number.isFinite(start)?start:Math.max(0,contact-1/3);
 const probe=JSON.parse(await run(ffprobe,['-v','error',...(sampled?['-read_intervals',`${Math.max(0,probeStart-2)}%${probeStart+10.2}`]:[]),'-select_streams','v:0','-show_entries',`stream=width,height,avg_frame_rate:format=duration${sampled?':frame=best_effort_timestamp_time':''}`,'-of','json',video]));
 const stream=probe.streams?.[0];if(!stream)throw Error('No video stream found.');
 const [n,d]=stream.avg_frame_rate.split('/').map(Number);const fps=n/d;
 if(!Number.isFinite(fps)||fps<5||fps>240)throw Error('Unsupported frame rate.');
 const total=Number(probe.format.duration);start=Number.isFinite(start)?start:Math.max(0,contact-1/3);
 if(start<0||start>=total)throw Error('Segment start is outside the video.');
 const frameStride=sampled?Math.max(5,Math.round(fps/6)):1;
 if(full&&!sampled&&(total-start>60||(total-start)*fps>3600))throw Error('For this test page, choose a clip with at most 60 seconds and 3,600 frames remaining.');
 const duration=sampled?Math.min(10,60*frameStride/fps,total-start):full?total-start:Math.min(8,360/fps,total-start);
 const rawTimes=sampled?probe:JSON.parse(await run(ffprobe,['-v','error','-read_intervals',`${Math.max(0,start-2)}%${start+duration+.2}`,'-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','json',video]));
 const times=rawTimes.frames.map(f=>Number(f.best_effort_timestamp_time)).filter(t=>Number.isFinite(t)&&t>=start-1e-6&&t<start+duration-1e-6).filter((_,i)=>i%frameStride===0);
 const maxSize=sampled?640:1920;
 await run(ffmpeg,['-v','error','-y','-ss',String(start),'-i',video,'-t',String(duration),'-an','-vf',`${sampled?`select=not(mod(n\\,${frameStride})),`:''}scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`,'-fps_mode','passthrough','-q:v','3','-threads','2',path.join(frames,'frame-%05d.jpg')]);
 const files=fs.readdirSync(frames).filter(f=>/^frame-\d+\.jpg$/.test(f)).sort();
 if(files.length<2||Math.abs(files.length-times.length)>1)throw Error('Frame timing could not be matched reliably.');
 const imageProbe=jpegDimensions(path.join(frames,files[0]));
 const frameTimes=files.map((_,i)=>times[i]??(times.at(-1)+1/fps));
 const initial=Math.max(0,Math.min(files.length-1,Math.round((contact+10/fps-start)*fps)));
 const initialContact=Math.max(0,Math.min(files.length-1,Math.round((contact-start)*fps)));
 const session={id,dir,frames,files,video,name,fps:fps/frameStride,sourceFps:fps,frameStride,start,duration,width:imageProbe.width,height:imageProbe.height,times:frameTimes,initialFrame:sampled?0:full?initialContact:initial,full};sessions.set(id,session);
 fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({...publicSession(session),video},null,2));
 return publicSession(session);
}
const publicSession=s=>({id:s.id,name:s.name,fps:s.fps,sourceFps:s.sourceFps||s.fps,frameStride:s.frameStride||1,launchFrameCount:s.launchFrameCount||0,width:s.width,height:s.height,start:s.start,duration:s.duration,frameCount:s.files.length,times:s.times,frameNumbers:s.frameNumbers,initialFrame:s.initialFrame,full:s.full});
function rawSession(id){
 if(sessions.has(id))return sessions.get(id);if(typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id))return null;
 try{const dir=path.join(STORE,id),meta=JSON.parse(fs.readFileSync(path.join(dir,'session.json'))),frames=path.join(dir,'frames'),files=fs.readdirSync(frames).filter(f=>/^frame-\d+\.jpg$/.test(f)).sort();if(meta.id!==id||files.length<2||meta.times.length!==files.length)return null;const s={...meta,dir,frames,files,full:true,initialFrame:0};sessions.set(id,s);return s;}catch{return null;}
}
app.get('/api/session/:id',(req,res)=>{const s=rawSession(req.params.id);if(!s)return res.status(404).json({error:'This test session is no longer available. Load the video again.'});res.json(publicSession(s));});
const contactViews=new Map();
app.post('/api/session/:id/contact',(req,res)=>{
 const source=rawSession(req.params.id),time=Number(req.body.time);
 if(source?.streamed)return res.json(publicSession(source));
 if(!source)return res.status(404).json({error:'The prepared video is no longer available.'});
 if(!Number.isFinite(time))return res.status(400).json({error:'Use a valid confirmed contact time.'});
 const fps=source.sourceFps||source.fps,index=source.times.findIndex(t=>Math.abs(t-time)<=.55/fps);
 if(index<0||index+Math.ceil(fps*.2)>=source.launchFrameCount)return res.status(409).json({error:'Confirmed contact needs a new dense frame window.'});
 if(index===0)return res.json(publicSession(source));
 const key=source.id+':'+index,existing=contactViews.get(key);
 if(existing&&sessions.has(existing))return res.json(publicSession(sessions.get(existing)));
 const id=crypto.randomUUID(),dir=path.join(STORE,id),frames=path.join(dir,'frames');fs.mkdirSync(frames,{recursive:true});
 const files=source.files.slice(index).map((name,i)=>{const destination=`frame-${String(i+1).padStart(5,'0')}.jpg`;fs.linkSync(path.join(source.frames,name),path.join(frames,destination));return destination;});
 const session={...source,id,dir,frames,files,times:source.times.slice(index),frameNumbers:source.frameNumbers?.slice(index),start:source.times[index],launchFrameCount:source.launchFrameCount-index,initialFrame:0};
 sessions.set(id,session);contactViews.set(key,id);fs.writeFileSync(path.join(dir,'session.json'),JSON.stringify({...publicSession(session),video:source.video}));res.json(publicSession(session));
});
app.get('/api/session/:id/video',(req,res)=>{const s=rawSession(req.params.id);if(!s||!fs.existsSync(s.video))return res.sendStatus(404);res.sendFile(path.resolve(s.video));});
app.get('/api/examples',(req,res)=>res.json({examples:EXAMPLES.filter(e=>fs.existsSync(e.video)).map(e=>({id:e.id,name:e.name})),isolated:true}));
app.get('/api/health',(req,res)=>res.json({ok:true,isolated:true,production_database_opened:false}));
app.post('/api/session',(req,res,next)=>preparing?res.status(409).json({error:'A segment is already loading. Please wait.'}):next(),upload.single('video'),async(req,res,next)=>{
 if(preparing)return res.status(409).json({error:'A segment is already loading. Please wait.'});
 preparing=true;
 try{
  let video,name,contact=0;const example=EXAMPLES.find(e=>e.id===req.body.example);
  if(req.file){video=req.file.path;name=path.basename(req.file.originalname);}
  else if(example&&fs.existsSync(example.video)){({video,name,contact}=example);}
  else if(rawSession(req.body.session)){const prior=rawSession(req.body.session);video=prior.video;name=prior.name;}
  else return res.status(400).json({error:'Choose a video or an available example.'});
  const start=req.body.start===''||req.body.start==null?undefined:Number(req.body.start);
  if(start!==undefined&&!Number.isFinite(start))return res.status(400).json({error:'Use a valid segment start time.'});
  if(req.body.streamed==='1'){
   const id=crypto.randomUUID(),dir=path.join(STORE,id),width=Number(req.body.width),height=Number(req.body.height),sourceFps=Number(req.body.source_fps);
   if(!Number.isFinite(width)||!Number.isFinite(height)||width<2||height<2||width>16384||height>16384||!Number.isFinite(sourceFps)||sourceFps<5||sourceFps>240)throw Error('Video dimensions and frame rate are required.');
   fs.mkdirSync(dir,{recursive:true});prewarmModel();
   const source={id,dir,video,name,width,height,sourceFps,fps:sourceFps,files:[],times:[],streamed:true,start:0,duration:0};sessions.set(id,source);return res.json({...publicSession(source),streamed:true});
  }
  res.json(await prepare(video,{start,contact,name,full:req.body.mode==='contact',sampled:req.body.sampled==='1',sourceFps:Number(req.body.source_fps)}));
 }catch(error){next(error);}finally{preparing=false;}
});
app.get('/api/session/:id/frame/:frame',(req,res)=>{
 const s=sessions.get(req.params.id),index=Number(req.params.frame);if(!s||!Number.isInteger(index)||index<0||index>=s.files.length)return res.sendStatus(404);
 res.sendFile(path.join(s.frames,s.files[index]));
});
app.post('/api/track',async(req,res)=>{
 const s=sessions.get(req.body.session);if(!s)return res.status(404).json({error:'Load a video segment first.'});
 if([...jobs.values()].some(j=>j.state==='running'))return res.status(409).json({error:'A tracking batch is already running.'});
 const anchors=req.body.anchors;
 if(!Array.isArray(anchors)||!anchors.length||anchors.length>40||anchors.some(a=>!Number.isInteger(a.frame)||a.frame<0||a.frame>=s.files.length||!Number.isFinite(a.x)||!Number.isFinite(a.y)||a.x<0||a.y<0||a.x>=s.width||a.y>=s.height)||new Set(anchors.map(a=>a.frame)).size!==anchors.length)return res.status(400).json({error:'Use valid, distinct ball marks inside the frames.'});
 const id=crypto.randomUUID(),job={id,session:s.id,state:'running'};jobs.set(id,job);const input=path.join(s.dir,id+'-input.json'),output=path.join(s.dir,id+'-result.json');
 fs.writeFileSync(input,JSON.stringify({frames_dir:s.frames,fps:s.fps,anchors:anchors.map(a=>({frame:a.frame,x:a.x,y:a.y})),max_steps:Math.min(60,Math.round(s.fps*.9))}));
 res.status(202).json({id});
 try{await runTracking(input,output);job.result=JSON.parse(fs.readFileSync(output));job.state='done';}
 catch(error){job.state='failed';job.error=error.message;}
});
app.post('/api/detect',async(req,res)=>{
 const s=rawSession(req.body.session);if(!s)return res.status(404).json({error:'Load a video first.'});
 if([...jobs.values()].some(j=>j.state==='running'))return res.status(409).json({error:'Detection is already running.'});
 const c=req.body.contact;
 if(s.streamed){
  const start=Number(req.body.time),fps=Number(req.body.source_fps)||s.sourceFps;
  if(!Number.isFinite(start)||start<0||start>86400||!Number.isFinite(fps)||fps<5||fps>240||!c||!Number.isFinite(c.x)||!Number.isFinite(c.y)||c.x<0||c.y<0||c.x>=s.width||c.y>=s.height)return res.status(400).json({error:'Mark a valid contact point.'});
  const id=crypto.randomUUID(),job={id,session:s.id,state:'running',progress:{phase:'decode',message:'Loading launch frames',completed:0,total:0}};jobs.set(id,job);
  const input=path.join(s.dir,id+'-contact-input.json'),output=path.join(s.dir,id+'-contact-result.json'),model=path.join(s.dir,id+'-model');job.model_manifest=freezeModel(model);
  fs.writeFileSync(input,JSON.stringify({video_path:s.video,ffmpeg,start,source_fps:fps,input_width:s.width,input_height:s.height,contact:{frame:0,x:c.x,y:c.y},detection_stride:1}));
  res.status(202).json({id,model_fingerprint:job.model_manifest.fingerprint});
  try{
   await frozenTrack(model,input,output,job);
   for(const [file,hash] of Object.entries(job.model_manifest.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(model,file))).digest('hex')!==hash)throw Error('Frozen detector source changed; discard this run.');
   job.result=JSON.parse(fs.readFileSync(output));job.result.model_fingerprint=job.model_manifest.fingerprint;job.state='done';
  }catch(error){if(job.state!=='cancelled'){job.state='failed';job.error=error.message;}}
  return;
 }
 const sampling=req.body.sampling||'dense';if(!['dense','adaptive'].includes(sampling))return res.status(400).json({error:'Use dense or adaptive sampling.'});
 if(!c||!Number.isInteger(c.frame)||c.frame<0||c.frame>=s.files.length-1||!Number.isFinite(c.x)||!Number.isFinite(c.y)||c.x<0||c.y<0||c.x>=s.width||c.y>=s.height)return res.status(400).json({error:'Mark the contact point before the end of the clip.'});
 const id=crypto.randomUUID(),job={id,session:s.id,state:'running',progress:{completed:0,total:s.files.length-c.frame-1,detected:0}};jobs.set(id,job);
 const input=path.join(s.dir,id+'-contact-input.json'),output=path.join(s.dir,id+'-contact-result.json');
 const model=path.join(s.dir,id+'-model');job.model_manifest=freezeModel(model);
 fs.writeFileSync(input,JSON.stringify({frames_dir:s.frames,fps:s.fps,frame_times:s.times,sampled_frames:(s.frameStride||1)>1,source_frame_stride:s.frameStride||1,source_fps:s.sourceFps||s.fps,launch_frame_count:s.launchFrameCount||0,contact:{frame:c.frame,x:c.x,y:c.y},detection_stride:sampling==='adaptive'?Math.max(1,Math.min(6,Math.round(s.fps/10))):1}));res.status(202).json({id,model_fingerprint:job.model_manifest.fingerprint});
 try{await frozenTrack(model,input,output,job);for(const [file,hash] of Object.entries(job.model_manifest.files)){if(crypto.createHash('sha256').update(fs.readFileSync(path.join(model,file))).digest('hex')!==hash)throw Error('Frozen detector source changed; discard this run.');}job.result=JSON.parse(fs.readFileSync(output));job.result.model_fingerprint=job.model_manifest.fingerprint;job.state='done';}
 catch(error){if(job.state!=='cancelled'){job.state='failed';job.error=error.message;}}
});
app.delete('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.sendStatus(404);if(j.state==='running'){j.state='cancelled';j.cancel?.();}res.json({state:j.state});});
app.get('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.sendStatus(404);res.json(j);});
app.get('/logo.png',(req,res)=>res.sendFile(path.join(ROOT,'static/logo/gameframe-logo-app.png')));
app.use(express.static(path.join(__dirname,'public'),{index:'index.html',dotfiles:'deny'}));
app.use((err,req,res,next)=>{console.error(err.message);if(!res.headersSent)res.status(400).json({error:err.message});});
if(require.main===module){const port=Number(process.env.GAMEFRAME_BALL_LAB_PORT||8017);app.listen(port,'127.0.0.1',()=>{fs.writeFileSync(path.join(STORE,'server.pid'),String(process.pid));startVision();console.log('Ball assist test page: http://127.0.0.1:'+port);});}
module.exports={app,prepare,sessions,jobs,ROOT,STORE,stopModels:()=>modelWorkers.stop()};
