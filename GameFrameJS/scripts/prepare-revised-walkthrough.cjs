const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/instruction-continuous');
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
const run=(binary,args)=>new Promise((resolve,reject)=>{const p=spawn(binary,args,{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out));});
(async()=>{
 const output=path.join(base,'revised-handoff.mp4');
 const filter="[0:v]setpts=PTS-STARTPTS,fps=25,scale=1200:900,setsar=1[a];[1:v]setpts=PTS-STARTPTS,select='not(between(t,1,5)+between(t,14.706,18.706)+between(t,32.034,35.034))',setpts=N/(FRAME_RATE*TB),fps=25,scale=1200:900,setsar=1[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p[v]";
 await run(ffmpeg,['-y','-v','error','-threads','1','-ss','237.512','-t','2.5','-i',path.join(base,'recordings/walkthrough-final/normalized.webm'),'-threads','1','-ss','22.986','-t','42.034','-i',path.join(base,'recordings/timing-final/normalized.webm'),'-filter_complex_threads','1','-filter_complex',filter,'-map','[v]','-an','-c:v','libx264','-preset','ultrafast','-crf','16','-threads','2','-movflags','+faststart',output]);
 const probe=JSON.parse(await run(ffprobe,['-v','error','-show_format','-of','json',output]));
 const planFile=path.join(base,'revised-walkthrough-edit-plan.json'),plan=JSON.parse(fs.readFileSync(planFile));plan.videos[0].scenes[8].end=Number(probe.format.duration);plan.same_swing_evidence={ev_hit_id:103,swing_clip_id:132,pitch_clip_id:69,source_database:'demo-output/instruction-continuous/tutorial-snapshot.db'};
 fs.writeFileSync(planFile,JSON.stringify(plan,null,2));console.log('Prepared live Save hit → crop/timing handoff: '+probe.format.duration+' seconds');
})().catch(e=>{console.error(e);process.exitCode=1});
