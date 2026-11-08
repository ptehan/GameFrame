const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),folder=process.env.WALKTHROUGH_DIR?path.resolve(process.env.WALKTHROUGH_DIR):path.join(root,'demo-output','cortland-double-85');
const session=JSON.parse(fs.readFileSync(path.join(folder,'session.json')));
const evDir=path.join(root,'demo-output',`hit-${session.hit_id}-tagged-frames`),relatedDir=path.join(folder,'related');
const ev=JSON.parse(fs.readFileSync(path.join(evDir,'manifest.json'))),related=JSON.parse(fs.readFileSync(path.join(relatedDir,'manifest.json')));
const guide=path.join(folder,'guide');fs.mkdirSync(path.join(guide,'images'),{recursive:true});
const entries=[],scenes=[];
const required=(list,title)=>{const e=list.find(e=>e.title===title);if(!e)throw new Error('Missing capture: '+title);return e;};
function copy(entry,dir,chapter,note){
 const file='images/'+String(entries.length+1).padStart(2,'0')+'-'+entry.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'')+path.extname(entry.file);
 fs.copyFileSync(path.join(dir,entry.file),path.join(guide,file));
 const e={...entry,file,group:chapter,note:note??entry.note};entries.push(e);return e;
}
function scene(chapter,title,images,text,extra={}){
 scenes.push({chapter,title,images:images.map(e=>path.join(guide,e.file)),text,...extra});
}
function poster(asset,name,time){
 const file=path.join(guide,'images',name+'.png');
 const r=spawnSync(require('ffmpeg-static'),['-v','error','-y','-ss',String(time),'-i',asset.path,'-frames:v','1',file],{windowsHide:true});
 if(r.status!==0)throw new Error(r.stderr?.toString());return file;
}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});
 const logo=fs.readFileSync(path.join(root,'static/logo/gameframe-logo-app.png')).toString('base64');
 await page.setContent(`<!doctype html><style>*{box-sizing:border-box}body{margin:0;padding:70px 90px;background:#f1f6f2;color:#143c2b;font-family:Arial;height:900px}img{width:310px}h1{font-size:74px;margin:75px 0 18px;letter-spacing:-2px}p{font-size:28px;line-height:1.45;color:#526b5c}.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:70px}.step{border-top:5px solid #21846a;padding:20px 4px;font-size:25px;font-weight:bold}.step span{display:block;font-size:17px;color:#5b7163;margin-top:12px;font-weight:normal}</style><img src="data:image/png;base64,${logo}"><h1>Cortland double</h1><p>From the recorded hit to a finished timing matchup.</p><div class="steps"><div class="step">1. Exit velocity<span>Contact, ball flight and field marks</span></div><div class="step">2. Swing timing<span>Crop, commitment and swing start</span></div><div class="step">3. Pitch speed<span>Contact, release and distance</span></div><div class="step">4. Matchup<span>Choose clips, create and download</span></div></div>`);
 await page.screenshot({path:path.join(guide,'images','cover.png')});await browser.close();
 const cover={group:'Overview',title:'Cortland double - complete walkthrough',note:'The guide follows the saved Cortland example through EV, swing timing, a separate measured pitch, and a timing matchup.',file:'images/cover.png'};entries.push(cover);
 scene('Overview','Cortland double',[cover],"We’ll use the Cortland double to estimate exit velocity and tag the swing. Then we’ll measure a separate pitch and create a timing matchup.");
 const ch1='1. Exit velocity';
 const evEntries=new Map();
 for(const e of ev.entries){
  if(e.title==='Saved video playback')continue;
  const replacement=e.title==='Ground-contact visibility'?required(related.entries,'Ground-contact visibility'):e;
  const dir=replacement===e?evDir:relatedDir;
  evEntries.set(e.title,copy(replacement,dir,ch1));
 }
 const get=t=>evEntries.get(t)||(()=>{throw new Error('Missing EV step '+t)})();
 scene(ch1,'Choose the original video',[get('Choose original video')],"Start with the original recording. Keep its capture frame rate, and include contact and the early ball flight.");
 scene(ch1,'Camera position',[get('Camera position')],"Find the correct diamond on the satellite image. Mark where the camera was located when this hit was filmed.");
 scene(ch1,'Home plate and field direction',[get('Home plate on map'),get('Second base on map')],"Mark home plate, then second base. These points establish the field’s direction and scale. Check the field size before continuing.");
 scene(ch1,'First landing',[get('Landing point on map'),get('Original saved map reference')],"Place the landing mark at first ground contact. Use fence corners, field landmarks, and where the outfielders move when the ball is hard to see.");
 scene(ch1,'Landing confidence',[get('Saved landing certainty')],"Choose confidence honestly. High allows five feet either way, medium allows ten, and low allows twenty. The landing mark and direction can change the estimate.");
 scene(ch1,'Contact',[get('Contact tag')],"Find the contact frame and click where bat and ball meet. This walkthrough uses the exact saved click and frame for the Cortland double.");
 scene(ch1,'Early ball marks',[get('Ball tag - 10 frames after contact'),get('Ball tag - 15 frames after contact'),get('Ball tag - 20 frames after contact')],"Click the center of the ball at each selected frame. Here the early tags are at ten, fifteen, and twenty frames after contact. Early marks help constrain launch angle.");
 scene(ch1,'When the ball is hidden',[25,30,35,40].map(n=>get(`${n} frames - tagged not visible`)),"The ball is not clearly visible in these saved frames. Use Not visible instead of inventing a position. You can keep moving through the sequence.");
 scene(ch1,'A later visible mark',[get('Ball tag - 45 frames after contact')],"The ball is visible again at forty-five frames, so keep that mark. Later positions add evidence about the height and timing of the flight.");
 scene(ch1,'Continue the marked sequence',[get('50 frames - tagged not visible'),get('Ball tag - 55 frames after contact')],"Fifty frames is skipped, and fifty-five gets another saved ball mark. Continue to the field marks when you are ready. Keep zoom and vertical framing steady for the later points.");
 scene(ch1,'Home plate and rubber in the video',[get('home plate'),get('pitching rubber')],"On the displayed contact reference, tag home plate and the pitching rubber. These are field-calibration points, separate from the ball clicks.");
 scene(ch1,'First-base line',[get('first baseline near'),get('first baseline far')],"Click two clear points along the first-base line, spaced well apart. Follow the actual line rather than the edge of the grass.");
 scene(ch1,'Third-base line',[get('third baseline near'),get('third baseline far')],"Do the same on the third-base line. If a required feature cannot be identified, use Not visible and keep the evidence honest.");
 const ground=get('Ground-contact visibility');ground.note='This Cortland example has no saved ground-contact tag. When visible, a newly tagged ground frame defaults to +/- half a frame; flight-duration tolerance also includes contact timing.';
 scene(ch1,'Ground-contact visibility',[ground],"If first ground contact is visible, tag its exact frame. The ground mark uses half-frame precision, with contact timing included in the duration. This example has no saved ground tag, so we continue without one.");
 scene(ch1,'Review the estimate',[get('Saved estimate')],"Review the estimate, its range, and the explanation. This saved version is about eighty-six miles per hour, twenty-one degrees, and three hundred twelve feet. Those are video-based estimates.");
 const completion=copy(required(related.entries,'EV video saved'),relatedDir,ch1,'The existing EV video is ready. Download it, or use Finish swing timing to continue with the known contact frame.');
 scene(ch1,'Save the EV video',[completion],"Save the video when the review is ready. The finished EV output is available here, and Finish swing timing carries the known contact forward.");
 const evPoster=poster(session.existing.ev,'existing-ev-output',2);
 const evOutput={group:ch1,title:'Existing EV output',note:'The accompanying video inserts the complete, existing EV output for this saved Cortland hit at this point.',file:path.relative(guide,evPoster)};entries.push(evOutput);
 scene(ch1,'Existing EV output',[evOutput],"The saved export includes exit velocity, launch angle, distance, and the marked flight. Keep its uncertainty in mind when comparing results.",{source_video:session.existing.ev.path,source_sha256:session.existing.ev.sha256,source_duration_s:session.existing.ev.duration_s,source_has_audio:true,voice_delay_s:6});
 const ch2='2. Swing timing';const swingEntries=new Map();
 for(const title of ['Choose swing video and hitter','Crop swing','Mark swing contact','Mark swing commitment','Mark swing start','Saved swing playback']){
  const e=required(related.entries,title);let note=e.note;
  if(title==='Choose swing video and hitter')note='Optional standalone entry. Continuing from EV carries the selected player and contact frame forward.';
  if(title==='Mark swing contact')note='Contact is already known in this EV-to-swing workflow; this editing screen is optional.';
  swingEntries.set(title,copy(e,relatedDir,ch2,note));
 }
 scene(ch2,'Continue to swing timing',[completion],"Choose Finish swing timing from the saved EV video. The team, hitter, and contact carry forward, so they do not need to be entered again.");
 scene(ch2,'Crop the swing',[swingEntries.get('Crop swing')],"Move the crop onto the hitter. Keep the body and bat in view around contact, then confirm the crop. Cropping changes presentation, not the timing marks.");
 scene(ch2,'Swing commitment',[swingEntries.get('Mark swing commitment')],"Select the frame you use as commitment to the swing. Apply the same visual criterion across clips. In this saved example it is five frames before contact.");
 scene(ch2,'Swing start',[swingEntries.get('Mark swing start')],"Now select swing start: the first movement you use as the timing reference. Here start is twenty-one frames before contact, about seven-tenths of a second.");
 scene(ch2,'Save swing timing',[swingEntries.get('Saved swing playback')],"Confirming start saves the tagged swing. This example has about seven-tenths from start to contact, and seventeen hundredths from commitment to contact. It is now ready for a matchup.");
 const ch3='3. Pitch creation';const pitchEntries=new Map();
 for(const title of ['Choose pitch video','Choose team and pitcher','Choose pitch clip start','Crop pitch','Mark pitch contact','Pitch speed setup','Choose release frame','Review pitch speed and distances','Save and export pitch video'])pitchEntries.set(title,copy(required(related.entries,title),relatedDir,ch3));
 const pitchStep=t=>pitchEntries.get(t);
 scene(ch3,'Choose the pitch video',[pitchStep('Choose pitch video')],"For the pitch, choose a recording that shows release and contact. This is the separate saved pitch used in the matchup.");
 scene(ch3,'Team and pitcher',[pitchStep('Choose team and pitcher')],"Select its team and pitcher once. Those selections stay with the pitch through the remaining steps.");
 scene(ch3,'Clip start',[pitchStep('Choose pitch clip start')],"Set the clip start so the pitch’s release and contact are both inside the selected window, then continue.");
 scene(ch3,'Pitch crop',[pitchStep('Crop pitch')],"Set a crop that keeps the pitching action visible. If the recording is already portrait, preserve the useful view rather than cutting off the action.");
 scene(ch3,'Pitch contact',[pitchStep('Mark pitch contact')],"Choose bat contact for a hit, or glove contact for a caught pitch. Use the actual contact frame rather than a later bounce, then confirm it.");
 scene(ch3,'Distance and a search range',[pitchStep('Pitch speed setup')],"Set the real rubber-to-plate distance. An approximate speed range only narrows the release frames to inspect; it does not determine the measured speed.");
 scene(ch3,'Find release',[pitchStep('Choose release frame')],"Compare the adjacent frames where the ball goes from in the hand to free of the hand. Here release is halfway between frames ninety-two and ninety-three, using a sixty-frame-per-second timing rate.");
 scene(ch3,'Review pitch speed',[pitchStep('Review pitch speed and distances')],"Check release extension and contact ahead of the plate. This saved example gives about eighty-three and a half miles per hour out of the hand, and seventy-nine and a half on average.");
 scene(ch3,'Save and export',[pitchStep('Save and export pitch video')],"Save the speed measurement. Library opens with the pitch selected. Choose Play to open its video and download the annotated export. The measured pitch is also ready for a matchup.");
 const pitchPoster=poster(session.existing.pitch,'existing-pitch-output',3);
 const pitchOutput={group:ch3,title:'Existing pitch-speed output',note:'The accompanying video inserts the already saved pitch-speed export here.',file:path.relative(guide,pitchPoster)};entries.push(pitchOutput);
 scene(ch3,'Existing pitch-speed output',[pitchOutput],"This is the existing pitch-speed export for the example, with the saved release, contact, and speed measurement.",{source_video:session.existing.pitch.path,source_sha256:session.existing.pitch.sha256,source_duration_s:session.existing.pitch.duration_s,source_has_audio:false,voice_delay_s:3});
 const ch4='4. Matchup creation',matchEntries=new Map();
 for(const title of ['Choose saved pitch','Choose saved swing','Review matchup','Matchup playback and download'])matchEntries.set(title,copy(required(related.entries,title),relatedDir,ch4));
 scene(ch4,'Choose the saved pitch',[matchEntries.get('Choose saved pitch')],"Open Matchup and choose the measured pitch. Its saved speed measurement carries into the comparison.");
 scene(ch4,'Choose the saved swing',[matchEntries.get('Choose saved swing')],"Choose the Cortland swing with its timing tags. You are selecting an existing saved clip, not tagging the swing again.");
 scene(ch4,'Create the matchup',[matchEntries.get('Review matchup')],"Review both clips, add an optional description, and create the matchup. The clips are aligned at contact so you can compare their timing.");
 const matchupPoster=poster(session.existing.matchup,'existing-matchup-output',7);
 const matchupOutput={group:ch4,title:'Existing matchup output',note:'The complete existing matchup output is included here in the narrated video.',file:path.relative(guide,matchupPoster)};entries.push(matchupOutput);
 scene(ch4,'Existing matchup output',[matchupOutput],"Watch the swing start and commitment markers against the pitch. Contact is the common alignment point for this timing comparison.",{source_video:session.existing.matchup.path,source_sha256:session.existing.matchup.sha256,source_duration_s:session.existing.matchup.duration_s,source_has_audio:false,voice_delay_s:3});
 scene(ch4,'Playback and download',[matchEntries.get('Matchup playback and download')],"The video download and timing image are beside the player. The full process is complete: exit velocity, swing timing, pitch speed, and the finished matchup.");
 const playbackIndex=entries.findIndex(e=>e.title==='Matchup playback and download');
 entries.push(...entries.splice(playbackIndex,1));
 const manifest={title:session.title,hit_id:session.hit_id,swing_id:session.swing_id,pitch_id:session.pitch_id,matchup_id:session.matchup_id,entries,source_outputs:session.existing};
 fs.writeFileSync(path.join(guide,'manifest.json'),JSON.stringify(manifest,null,2));
 const html=fs.readFileSync(path.join(__dirname,'screen-gallery-template.html'),'utf8').replace('__SCREEN_DATA__',JSON.stringify(entries).replace(/</g,'\\u003c'));fs.writeFileSync(path.join(guide,'index.html'),html);
 fs.writeFileSync(path.join(folder,'storyboard.json'),JSON.stringify({title:session.title,voice:'en_US-joe-medium',scenes},null,2));
 fs.writeFileSync(path.join(folder,'voiceover-script.txt'),scenes.map(s=>`${s.chapter} / ${s.title}\n${s.text}`).join('\n\n'));
 console.log(JSON.stringify({pages:entries.length,scenes:scenes.length,words:scenes.map(s=>s.text).join(' ').split(/\s+/).length,guide,storyboard:path.join(folder,'storyboard.json')}));
})().catch(e=>{console.error(e);process.exitCode=1});
