const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/gameframe-20261106'),delivery=path.join(root,'output/final-videos/2026-11-06');
fs.mkdirSync(delivery,{recursive:true});
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const kinds=process.argv[2]?[process.argv[2]]:['overview','walkthrough','technical','hit-timing'];
const indexFile=path.join(delivery,'delivery.json'),index=fs.existsSync(indexFile)?JSON.parse(fs.readFileSync(indexFile)):{date:'2026-11-06',example_hit:102,caption_layers:1,files:[]};
for(const kind of kinds){
 const folder=path.join(base,kind),story=JSON.parse(fs.readFileSync(path.join(folder,'timed-storyboard.json'))),report=JSON.parse(fs.readFileSync(path.join(folder,'render-report.json')));
 const probe=JSON.parse(spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-show_format','-of','json',report.video],{encoding:'utf8',windowsHide:true}).stdout);
 const video=probe.streams.find(s=>s.codec_type==='video');
 if(video.width!==1280||video.height!==720||video.r_frame_rate!=='30/1')throw Error(kind+': wrong output geometry/rate');
 if(Number(video.nb_frames)!==story.total_frames)throw Error(kind+': missing output frames');
 if(!probe.streams.some(s=>s.codec_type==='audio')||probe.streams.some(s=>s.codec_type==='subtitle'))throw Error(kind+': incorrect audio/subtitle tracks');
 if(Math.abs(Number(probe.format.duration)-story.duration_s)>.15)throw Error(kind+': narration duration mismatch');
 const decoded=spawnSync(require('ffmpeg-static'),['-v','error','-xerror','-threads','1','-i',report.video,'-map','0:v:0','-f','null','-'],{encoding:'utf8',windowsHide:true,timeout:240000});
 if(decoded.status!==0)throw Error(kind+': full decode failed: '+decoded.stderr);
 fs.mkdirSync(path.join(folder,'video-qa'),{recursive:true});
 const packaged=spawnSync(process.execPath,[path.join(root,'scripts/package-single-caption-video.cjs'),folder,path.join(delivery,path.basename(report.video))],{encoding:'utf8',windowsHide:true});
 if(packaged.status!==0)throw Error(packaged.stderr);
 const file=path.join(delivery,path.basename(report.video)),voice=path.join(delivery,path.basename(story.voiceover_mp3));fs.copyFileSync(story.voiceover_mp3,voice);
 const qa=path.join(folder,'video-qa');fs.mkdirSync(qa,{recursive:true});
 for(const [label,time] of [['opening',Math.min(3,story.duration_s/5)],['middle',story.duration_s/2],['closing',story.duration_s-3]]){
  const result=spawnSync(require('ffmpeg-static'),['-v','error','-y','-ss',String(time),'-i',file,'-frames:v','1',path.join(qa,label+'.png')],{encoding:'utf8',windowsHide:true});if(result.status)throw Error(result.stderr);
 }
 index.files=index.files.filter(f=>f.kind!==kind);index.files.push({kind,title:story.title,video:file,voiceover:voice,duration_s:story.duration_s,bytes:fs.statSync(file).size,sha256:sha(file),full_decode:true,single_caption_layer:true,chapters:report.chapters.length});
 fs.writeFileSync(indexFile,JSON.stringify(index,null,2));console.log(JSON.stringify(index.files.find(f=>f.kind===kind)));
}
