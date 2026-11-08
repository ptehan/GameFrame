const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const directory=path.resolve(process.argv[2]||'');
const destination=path.resolve(process.argv[3]||'demo-output/Pitch-Speed-Walkthrough.mp4');
const {captures,events}=JSON.parse(fs.readFileSync(path.join(directory,'recording.json')));
if(!captures?.length)throw new Error('No real screen captures to render.');
const onlyStage=process.argv[4]===undefined?null:Number(process.argv[4]);
if(onlyStage!==null&&(!Number.isInteger(onlyStage)||onlyStage<0||onlyStage>=events.length))throw new Error('Invalid stage index.');
fs.copyFileSync('C:/Windows/Fonts/arial.ttf',path.join(directory,'caption-font.ttf'));
const parts=[];
const escape=p=>p.replaceAll('\\','/').replaceAll("'","'\\''");
function ffmpeg(args){const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',windowsHide:true});if(r.status!==0)throw new Error(r.stderr||'ffmpeg failed');}
for(let i=0;i<events.length;i++){
 const event=events[i],end=events[i+1]?.seconds??captures.at(-1).seconds+.3;
 let selected=captures.filter(c=>c.seconds>=event.seconds&&c.seconds<end);
 if(!selected.length)continue;
 const processing=event.label.startsWith('Processing:');
 const accelerated=event.label==='Find and tag contact';
 if(processing&&end-event.seconds>4)selected=selected.filter(c=>c.seconds<event.seconds+1.5||c.seconds>end-1.5);
 const lines=[];
 for(let j=0;j<selected.length;j++){
  const next=selected[j+1]?.seconds??Math.min(end,selected[j].seconds+.3);
  lines.push(`file '${escape(path.join(directory,selected[j].file))}'`,`duration ${(Math.min(processing?0.5:2,Math.max(.04,next-selected[j].seconds))/(accelerated?3:1)).toFixed(3)}`);
 }
 lines.push(`file '${escape(path.join(directory,selected.at(-1).file))}'`);
 const list=path.join(directory,`part-${i}.txt`),label=path.join(directory,`label-${i}.txt`),part=path.join(directory,`part-${i}.mp4`);
 if(onlyStage!==null&&i!==onlyStage){
  if(!fs.existsSync(part))throw new Error('Render all stages before updating one stage.');
  parts.push(part);continue;
 }
 fs.writeFileSync(list,lines.join('\n'));
 const caption=event.label.replace('Processing: ','')+(processing?' | Processing wait shortened':accelerated?' | Frame stepping sped up 3x':'');
 const captionLines=[''];
 for(const word of caption.split(/\s+/)){
  const last=captionLines.length-1;
  if(captionLines[last].length+word.length+1>66)captionLines.push(word);
  else captionLines[last]+=(captionLines[last]?' ':'')+word;
 }
 fs.writeFileSync(label,captionLines.join('\n'));
 const closeup=/Pick the pitch|Select team|Set the clip|Review speed/.test(event.label);
 const libraryCloseup=/^(Saved pitch in library|Export the pitch speed video|Retrieve the saved pitch speed video|Saved export is ready|Processing: render and save pitch speed export|Processing: retrieve saved export)$/.test(event.label);
 const wizardCloseup=/^Choose a (pitch|swing)$|^(Review the matchup|Continue with the saved swing|Saved swing is ready for matchups|Review the saved clips)$/.test(event.label);
 const crop=event.label==='Pick the hit video'?"crop=620:500:x='if(lt(t,2),0,330)':y='if(lt(t,2),0,200)',":event.label==='Select the saved field address'?'crop=680:520:300:200,':event.label==='Enter team, hitter and description'?'crop=680:650:300:160,':event.label==='Play the saved pitch speed video'?'crop=520:420:0:0,':wizardCloseup?'crop=820:600:230:0,':libraryCloseup?'crop=640:400:640:140,':closeup?'crop=760:560:0:0,':'';
 const filter=crop+'scale=1280:900:force_original_aspect_ratio=decrease,pad=1280:1000:(ow-iw)/2:0:color=0xf3f4f5,drawbox=x=0:y=900:w=1280:h=100:color=0x073e38:t=fill,drawtext=fontfile=caption-font.ttf:textfile='+path.basename(label)+':fontcolor=white:fontsize=30:line_spacing=6:x=32:y='+(captionLines.length>1?916:934);
 // Relative textfile paths avoid Windows drive-letter filter escaping.
 const old=process.cwd();process.chdir(directory);
 try{ffmpeg(['-f','concat','-safe','0','-i',list,'-vf',filter,'-r','25','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-threads','2',part]);}finally{process.chdir(old);}
 parts.push(part);console.log(event.label);
}
const finalList=path.join(directory,'final-parts.txt');fs.writeFileSync(finalList,parts.map(p=>`file '${escape(p)}'`).join('\n'));
ffmpeg(['-f','concat','-safe','0','-i',finalList,'-c','copy','-movflags','+faststart',destination]);
console.log('Rendered '+destination);
