// Optional local test surface. The only database operation is a saved-source SELECT.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const PREFIX='/test/ball-assist';
function available(req){
 const local=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
 return local&&['localhost','127.0.0.1'].includes(req.hostname)&&process.env.GAMEFRAME_BALL_ASSIST_TEST!=='0'&&(process.env.NODE_ENV!=='production'||process.env.GAMEFRAME_BALL_ASSIST_TEST==='1');
}
function install(app,readHit){
 let lab,loading=false;
 const handle=(req,res,next)=>{
  if(!available(req))return res.sendStatus(404);
  if(req.method!=='GET'&&req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.sendStatus(403);}catch{return res.sendStatus(403);}}
  if((!req.path||req.path==='/')&&!req.originalUrl.split('?')[0].endsWith('/'))return res.redirect(303,PREFIX+'/'+(req.originalUrl.includes('?')?'?'+req.originalUrl.split('?')[1]:''));
  try{lab??=require('./server.cjs');}catch(error){return res.status(503).json({error:'The local ball-detection test is unavailable. The normal tagging flow is still available.'});}
  const match=/^\/api\/from-hit\/(\d+)$/.exec(req.path);
  if(!match)return lab.app(req,res,next);
  if(req.method!=='POST')return res.sendStatus(405);
  if(loading)return res.status(409).json({error:'A saved video is already loading.'});
  loading=true;
  (async()=>{
   let video;
   try{
    const row=readHit(Number(match[1]));
    if(!row?.clip_blob)return res.status(404).json({error:'This hit has no saved source video. Open a video in the test page instead.'});
    const contact=Number(row.contact_time_s)-Number(row.clip_start_time_s||0);
    if(row.contact_time_s==null||!Number.isFinite(contact)||contact<0)throw Error('The saved contact time could not be mapped to this source clip.');
    video=path.join(lab.STORE,'uploads',crypto.randomUUID()+'.mp4');
    await fs.promises.writeFile(video,row.clip_blob);
    res.json({...await lab.prepare(video,{contact,name:row.source_file_name||'Saved hit',full:true}),sourceHitId:Number(match[1]),sourceTimeOffset:Number(row.clip_start_time_s||0)});
   }catch(error){if(video)await fs.promises.unlink(video).catch(()=>{});res.status(400).json({error:error.message});}
   finally{loading=false;}
  })();
 };
 app.use(PREFIX,handle);
 // The normal EV wizard uses the detector API without visiting a test page.
 app.use('/api/ball-assist',(req,res,next)=>{req.url='/api'+req.url;handle(req,res,next);});
}
module.exports={install,available,PREFIX};
