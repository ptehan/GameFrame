// Assemble actual screen recordings; never composites or recreated controls.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/instruction-continuous');
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
const run=(exe,args)=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err=(err+d).slice(-10000));p.on('error',reject);p.on('close',c=>c?reject(Error(err)):resolve(out));});
const stamp=s=>{const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`};
async function renderFullPlayback(entry,folder){
 const source=path.resolve(root,entry.file),probe=JSON.parse(await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',source]));
 const sourceDuration=Number(probe.format.duration),duration=Math.ceil(sourceDuration*30)/30;
 if(!Number.isFinite(sourceDuration)||sourceDuration<=0)throw Error('Invalid full playback source');
 const hasAudio=probe.streams.some(s=>s.codec_type==='audio'),file=path.join(folder,'full-ev-playback.mp4');
 const args=['-y','-v','error','-threads','1','-i',source];
 if(!hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=mono');
 args.push('-map','0:v:0','-map',hasAudio?'0:a:0':'1:a:0','-filter_threads','1','-vf',`fps=30,scale=1280:960:force_original_aspect_ratio=decrease,pad=1280:960:(ow-iw)/2:(oh-ih)/2:color=black,tpad=stop_mode=clone:stop_duration=0.1,trim=duration=${duration},format=yuv420p`,'-af',`aresample=48000,aformat=channel_layouts=mono,apad,atrim=duration=${duration}`,'-c:v','libx264','-preset','veryfast','-crf','19','-threads',String(process.env.INSTRUCTION_ENCODER_THREADS||2),'-c:a','aac','-b:a','160k','-ar','48000','-t',String(duration),file);
 if(!(process.env.INSTRUCTION_REUSE_FULL_PLAYBACK==='1'&&fs.existsSync(file)&&fs.statSync(file).mtimeMs>fs.statSync(source).mtimeMs))await run(ffmpeg,args);
 return {file,duration,source_file:source,source_start_s:0,source_end_s:sourceDuration,source_duration_s:sourceDuration,speed:1,narration_over_playback:false,original_audio:hasAudio};
}
async function main(){
 const manifest=JSON.parse(fs.readFileSync(process.argv[2]||path.join(base,'edit-plan.json')));
 for(const video of manifest.videos){
  if(process.argv[3]&&process.argv[3]!==video.kind)continue;
  const narrationRoot=process.env.INSTRUCTION_NARRATION_ROOT?path.resolve(root,process.env.INSTRUCTION_NARRATION_ROOT):path.join(base,'narration');
  const narrationFile=path.join(narrationRoot,video.kind,'narration-manifest.json');
  const narration=JSON.parse(fs.readFileSync(narrationFile));
  const folder=path.join(base,'render',video.kind);fs.mkdirSync(folder,{recursive:true});const parts=[],insertions=[];let time=0,srt=[],caption=1;
  for(let i=0;i<video.scenes.length;i++){
   if(process.env.INSTRUCTION_CHUNK_ONLY==='1'&&!process.env.INSTRUCTION_REDO_SCENES?.split(',').map(Number).includes(i))continue;
   const scene=video.scenes[i],audio=narration.paragraphs[i];if(!audio)throw Error('Missing narration paragraph '+i);
   const source=path.resolve(root,scene.file),probe=JSON.parse(await run(ffprobe,['-v','error','-show_format','-of','json',source]));
   if(!Number.isFinite(Number(probe.format.duration))||scene.start<0||scene.end>Number(probe.format.duration)+.1||scene.end<=scene.start)throw Error('Invalid source interval '+JSON.stringify(scene));
   const gap=i<video.scenes.length-1?narration.paragraph_pause_s:0,target=audio.duration_s+gap;
   const inputDuration=scene.end-scene.start,omitted=(scene.omit||[]).reduce((n,[a,b])=>n+b-a,0);
   const duration=inputDuration-omitted,rate=Math.max(.72,Math.min(scene.maxRate||1.3,duration/target));
   const headPad=Math.max(0,target-duration/rate)*(scene.padAtStart||0);
   const chunk=path.join(folder,`part-${String(i).padStart(2,'0')}.mp4`);
   // Slow, eased optical movement over the intact recorded viewport.
   const zoom=scene.zoom||1,cx=scene.center?.[0]??.5,cy=scene.center?.[1]??.5;
   const delay=scene.zoomDelayFactor?target*scene.zoomDelayFactor:scene.zoomDelay||0;
   const ease=`min(1,min((on/30-${delay})/1.3,(${target}-on/30-${scene.zoomReturn||0})/${scene.zoomOut||1.3}))`;
   const z=`1+${zoom-1}*max(0,(${ease}))*max(0,(${ease}))*(3-2*max(0,(${ease})))`;
   const panStart=scene.panStart??.55,panEnd=scene.panEnd??.8;
   const pan=`max(0,min(1,(on/30-${target*panStart})/${target*(panEnd-panStart)}))`;
   const px=scene.panTo?`(${cx}+${scene.panTo[0]-cx}*(${pan})*(${pan})*(3-2*(${pan})))`:cx;
   const py=scene.panTo?`(${cy}+${scene.panTo[1]-cy}*(${pan})*(${pan})*(3-2*(${pan})))`:cy;
   const select=scene.omit?.length?`setpts=PTS-STARTPTS,select='not(${scene.omit.map(([a,b])=>`between(t,${a-scene.start},${b-scene.start})`).join('+')})',setpts=N/(FRAME_RATE*TB),`:'';
   const filter=`${select}setpts=(PTS-STARTPTS)/${rate},fps=30,tpad=start_mode=clone:start_duration=${headPad}:stop_mode=clone:stop_duration=${target},trim=duration=${target},${scene.grayscale?'hue=s=0,':''}scale=1600:1200:force_original_aspect_ratio=decrease,pad=1600:1200:(ow-iw)/2:(oh-ih)/2:color=black,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw*${px}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${py}-ih/zoom/2))':d=1:s=1280x960:fps=30,format=yuv420p`;
   const redo=process.env.INSTRUCTION_REDO_SCENES?.split(',').map(Number);
   const reuse=redo&&!redo.includes(i)&&fs.existsSync(chunk);
   if(reuse&&fs.statSync(chunk).mtimeMs<fs.statSync(narrationFile).mtimeMs){
    const previousFile=process.env.INSTRUCTION_PREVIOUS_NARRATION_MANIFEST;
    const previous=previousFile&&JSON.parse(fs.readFileSync(path.resolve(root,previousFile)));
    const old=previous?.paragraphs[i];
    if(!old||old.wav_sha256!==audio.wav_sha256||old.duration_s!==audio.duration_s||previous.paragraph_pause_s!==narration.paragraph_pause_s)throw Error('Cannot reuse a chunk from changed narration: '+chunk);
   }
   if(!reuse)await run(ffmpeg,['-y','-v','error','-threads','1','-ss',String(scene.start),'-t',String(inputDuration),'-i',source,'-i',audio.wav,'-filter_threads','1','-vf',filter,'-af',`apad=pad_dur=${gap},atrim=duration=${target}`,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','veryfast','-crf','19','-threads',String(process.env.INSTRUCTION_ENCODER_THREADS||2),'-c:a','aac','-b:a','160k','-ar','48000','-t',String(target),chunk]);
   parts.push(chunk);const words=audio.text.split(/\s+/);for(let j=0;j<words.length;j+=10){const start=time+audio.duration_s*j/words.length,end=time+audio.duration_s*Math.min(j+10,words.length)/words.length;srt.push(`${caption++}\n${stamp(start)} --> ${stamp(end)}\n${words.slice(j,j+10).join(' ')}\n`)}time+=target;
   console.log((reuse?'Reused ':'Rendered ')+video.kind+' '+(i+1)+'/'+video.scenes.length);
   if(process.env.INSTRUCTION_CHUNK_ONLY!=='1')for(const entry of video.full_playbacks||[]){if(entry.after_index!==i)continue;const playback=await renderFullPlayback(entry,folder);insertions.push({...playback,start_s:time,end_s:time+playback.duration});parts.push(playback.file);time+=playback.duration;console.log('Included complete EV video: '+playback.source_duration_s+' seconds at 1x, narration paused.');}
  }
  if(process.env.INSTRUCTION_CHUNK_ONLY==='1')continue;
  const list=path.join(folder,'concat.txt');fs.writeFileSync(list,parts.map(p=>`file '${p.replaceAll('\\','/').replaceAll("'","'\\''")}'`).join('\n'));
  const filename=process.env.INSTRUCTION_VIDEO_SUFFIX?video.filename.replace(/\.mp4$/,`-${process.env.INSTRUCTION_VIDEO_SUFFIX}.mp4`):video.filename;
  const final=path.join(root,'output/video',filename),staged=final.replace(/\.mp4$/,'.working.mp4');fs.mkdirSync(path.dirname(final),{recursive:true});await run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',list,'-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:a','aac','-b:a','160k','-ar','48000','-movflags','+faststart',staged]);
  const info=JSON.parse(await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',staged]));
  await run(ffmpeg,['-v','error','-threads','1','-i',staged,'-f','null','-']);
  fs.renameSync(staged,final);fs.writeFileSync(final.replace(/\.mp4$/,'.srt'),srt.join('\n'));
  fs.writeFileSync(path.join(folder,'verification.json'),JSON.stringify({file:final,expected_duration_s:time,actual_duration_s:Number(info.format.duration),streams:info.streams.map(s=>({type:s.codec_type,codec:s.codec_name,width:s.width,height:s.height,frame_rate:s.avg_frame_rate})),source_scenes:video.scenes,full_playbacks:insertions,decode_errors:0,narration:narration.full_wav,voice:narration.voice,engine:narration.engine,quality_limit:'Waveform and decode checks do not establish narration naturalness or measurement accuracy.'},null,2));console.log('Ready '+final);
 }
}
main().catch(e=>{console.error(e);process.exitCode=1});
