const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const folder=path.resolve(root,process.argv[2]||'demo-output/gameframe-polished/hit-timing');
const target=path.resolve(root,process.argv[3]||'output/final-videos/hit-timing-single-caption/Control-Your-Timing.mp4');
const story=JSON.parse(fs.readFileSync(path.join(folder,'timed-storyboard.json')));
const report=JSON.parse(fs.readFileSync(path.join(folder,'render-report.json')));
if(!story.captioned||story.burn_narration_captions===false)throw Error('Expected one burned-in subtitle layer.');
const seconds=stamp=>{const [h,m,s]=stamp.split(':').map(Number);return h*3600+m*60+s;};
for(const scene of story.scenes){
 const lines=fs.readFileSync(scene.caption_ass,'utf8').split('\n');
 if(lines.filter(s=>s.startsWith('Style:')).length!==1)throw Error('Multiple caption styles: '+scene.title);
 const cues=lines.filter(s=>s.startsWith('Dialogue:')).map(s=>{const p=s.split(',');return {start:seconds(p[1]),end:seconds(p[2])};}).sort((a,b)=>a.start-b.start);
 for(let i=1;i<cues.length;i++)if(cues[i].start<cues[i-1].end-.011)throw Error('Overlapping captions: '+scene.title);
}
const probe=spawnSync(require('ffprobe-static').path,['-v','error','-show_streams','-of','json',report.video],{encoding:'utf8',windowsHide:true});
if(probe.status)throw Error(probe.stderr);
const streams=JSON.parse(probe.stdout).streams;
if(streams.some(s=>s.codec_type==='subtitle'))throw Error('Unexpected second selectable subtitle track.');
const outdir=path.dirname(target);fs.mkdirSync(outdir,{recursive:true});
const sidecars=fs.readdirSync(outdir).filter(name=>/\.(srt|vtt|ass|ssa)$/i.test(name));
if(sidecars.length)throw Error('Subtitle sidecars in delivery folder: '+sidecars.join(', '));
fs.copyFileSync(report.video,target);
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if(sha(target)!==sha(report.video))throw Error('Delivered copy differs from verified master.');
const result={video:target,duration_s:story.duration_s,bytes:fs.statSync(target).size,burned_caption_styles:1,overlapping_caption_events:0,selectable_subtitle_tracks:0,external_subtitle_files:0,delivery_folder_files:fs.readdirSync(outdir)};
fs.writeFileSync(path.join(folder,'video-qa/single-caption-delivery.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result));
