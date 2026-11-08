const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/gameframe-polished'),prior=path.join(root,'demo-output/cortland-double-85-wide');
const old=JSON.parse(fs.readFileSync(path.join(prior,'storyboard.json'))),session=JSON.parse(fs.readFileSync(path.join(prior,'session.json')));
const related=JSON.parse(fs.readFileSync(path.join(base,'related/manifest.json')));
if(related.failures.length)throw new Error('Resolve capture failures before authoring videos.');
const overview=path.join(base,'overview'),walk=path.join(base,'walkthrough');
for(const f of [overview,walk])fs.mkdirSync(path.join(f,'images'),{recursive:true});
const imageFor=title=>{const e=related.entries.find(e=>e.title===title);if(!e)throw new Error('Missing '+title);return path.join(base,'related',e.file);};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uri=file=>'data:image/'+(path.extname(file)==='.png'?'png':'jpeg')+';base64,'+fs.readFileSync(file).toString('base64');
const logo=uri(path.join(root,'static/logo/gameframe-logo-app.png'));
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const video=(asset,duration,extra={})=>({source_video:asset.path,source_sha256:asset.sha256,source_duration_s:duration??asset.duration_s,source_has_audio:false,...extra});
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage({viewport:{width:1280,height:654}});
 async function brand(folder,name,eyebrow,title,sub,visual){
  const file=path.join(folder,'images',name+'.png');
  const height=folder===overview?720:654;
  await page.setViewportSize({width:1280,height});
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f1f6f2;color:#143c2b;font-family:Arial;height:654px;padding:34px 44px}header img{width:235px;height:auto}.eyebrow{margin-top:79px;font-size:12px;letter-spacing:1.4px;font-weight:700;text-transform:uppercase;color:#48735e;width:345px}h1{font-size:46px;line-height:1.05;letter-spacing:-1.5px;width:345px;margin:20px 0}p{width:340px;font-size:18px;line-height:1.45;color:#526b5c;margin:0}.visual{position:absolute;left:448px;top:80px;width:792px;height:500px;border:1px solid #d2dfd7;border-radius:14px;padding:6px;background:#101b17;box-shadow:0 15px 35px #183f261c;display:flex;align-items:center;justify-content:center}.visual img{width:100%;height:100%;object-fit:contain}.rule{position:absolute;left:44px;bottom:50px;width:300px;border-top:4px solid #9fbb50}</style><header><img src="${logo}"></header><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title).replace(/\n/g,'<br>')}</h1><p>${esc(sub)}</p><div class="visual">${visual?`<img src="${uri(visual)}">`:''}</div><div class="rule"></div>`);
  await page.addStyleTag({content:`body{height:${height}px}`});
  await page.screenshot({path:file});return file;
 }
 const chapter='GameFrame overview',scenes=[];
 const specs=[
  ['ceiling','Real games. Real metrics.','Showcase potential.\nMeasure game\nperformance.','Turn game video into performance metrics.',"Coaches use showcase velocity to see a player's ceiling. GameFrame adds metrics from real competition.", {path:session.source_path,sha256:sha(session.source_path),duration_s:9}],
  ['exit-velocity','Hit modeling · Exit velocity · Distance · Launch angle','Model the hit.\nSee the metrics.','Compare marked game footage with a huge database of modeled hits.',"Hit modeling is at the heart of GameFrame. It compares your marked ball flight and field measurements with a huge database of simulated hits to estimate exit velocity, distance, and launch angle. Here, that's eighty-six miles per hour, three hundred twelve feet, and twenty-one degrees. See the game footage, mapped landing, and modeled flight together.",session.existing.ev],
  ['measurements','Measured pitches for training and matchups','Know the speed.\nTrain the timing.','Measure pitch speed. Evaluate yourself on the mound. Train your timing at the plate.',"Measure pitch speed from video without an expensive radar gun. Evaluate your pitching, or train your timing as a hitter.",session.existing.pitch],
  ['matchups','Pitch speed meets swing timing','Create your\ntiming matchup.','Pair a measured pitch with a tagged swing. Align them at contact to train your consistent swing against different pitchers.',"Pair a measured pitch with your tagged swing. GameFrame aligns them at contact so you can train when to start your first move against different pitchers.",session.existing.matchup],
  ['guided','GameFrame guides you the whole way','Advanced metrics.\nSimple steps.','No steps to memorize. GameFrame tells you what to do next.',"You don't need to know the process or remember the steps. GameFrame guides you through everything, one instruction at a time.",null],
  ['finish','GameFrame','Show your game.\nBack it with\nmetrics.','Showcase yourself in real games. Start with a video and follow the guided instructions.',"Choose your video. Follow the prompts. Show your game with real metrics. That's GameFrame.",{path:session.source_path,sha256:sha(session.source_path),duration_s:9}],
 ];
 for(const [name,title,headline,sub,text,asset]of specs){
  const images=[];let extra={};
  if(asset){images.push(path.join(overview,'images',name+'.png'));extra={...video(asset,9),min_duration_s:9,source_duration_policy:'narration',voice_delay_s:.25};}
  else images.push(old.scenes.find(s=>s.title==='Contact').images[0],imageFor('Choose release frame'),imageFor('Choose saved pitch'));
  if(name==='exit-velocity')extra={...video(asset),voice_delay_s:.25};
  scenes.push({chapter,title,images,text,min_duration_s:9,voice_delay_s:.25,...extra});
 }
 const overviewStory={title:'GameFrame — See Your Swing in Real Games',output_basename:'GameFrame-Overview',kind:'overview',captioned:true,burn_narration_captions:true,expected_chapter_count:1,voice_scale:1.20,scenes};
 fs.writeFileSync(path.join(overview,'storyboard.json'),JSON.stringify(overviewStory,null,2));
 const replacements={
  'Save the EV video':'EV video saved','Continue to swing timing':'EV video saved','Crop the swing':'Crop swing','Swing commitment':'Mark swing commitment','Swing start':'Mark swing start','Save swing timing':'Saved swing playback',
  'Choose the pitch video':'Choose pitch video','Team and pitcher':'Choose team and pitcher','Clip start':'Choose pitch clip start','Pitch crop':'Crop pitch','Pitch contact':'Mark pitch contact','Distance and a search range':'Pitch speed setup','Find release':'Choose release frame','Review pitch speed':'Review pitch speed and distances','Save and export':'Save and export pitch video',
  'Choose the saved pitch':'Choose saved pitch','Choose the saved swing':'Choose saved swing','Create the matchup':'Review matchup','Playback and download':'Matchup playback and download'
 };
 const revised=old.scenes.slice(1).map(s=>({...s,images:replacements[s.title]?[imageFor(replacements[s.title])]:s.images}));
 const copy={
  'Camera position':'Enter the address of the field to pull up the real map. Find the correct diamond, then mark where the camera was located when this hit was filmed.',
  'Home plate and field direction':"Mark home plate, then second base, and check the field size. You don't need to remember the steps. GameFrame walks you through it.",
  'First landing':'You can watch the video here to compare landmarks in the video and on the map, so you can get the hit direction right. Place the landing mark at first ground contact.',
  'Early ball marks':'Click the center of the ball at each selected frame. Just follow each easy instruction. Early marks help constrain launch angle.',
  'Continue the marked sequence':'The fifty-frame mark is skipped in this example, and fifty-five gets another saved ball mark. Continue to the field marks when you are ready. Keep zoom and vertical framing steady for the later points.',
  'Ground-contact visibility':'If you can see the ball hit the ground, tag that frame. Ground contact is skipped in this example, so we continue without a ground tag.',
  'Review the estimate':'Review the estimate, its range, and the explanation. This saved hit is about eighty-six miles per hour, twenty-one degrees, and three hundred twelve feet. GameFrame compares the video-based measurements against a huge database of modeled hits to estimate the result.',
  'Save the EV video':'Save the video when the review is ready. This swing can now be set up for use in GameFrame pitch-timing matchups.',
  'Existing EV output':'The saved export includes exit velocity, launch angle, distance, and the marked flight.',
  'Swing commitment':'Select the frame when the player commits to the swing. In this saved example, commitment is about one hundred sixty-seven milliseconds before contact.',
  'Swing start':'Now select the moment the player starts his first move. Here, that is about seven hundred milliseconds before contact.',
  'Save swing timing':'Confirming the first move saves the tagged swing. This example has about seven hundred milliseconds from first move to contact, and one hundred sixty-seven milliseconds from commitment to contact. It is now ready for a matchup.',
  'Choose the original video':'Start with the original recording. GameFrame will guide each mark, beginning with contact and the early ball flight.',
  'Contact':'Find the frame when bat and ball meet, then click the contact point on the bat. GameFrame tells you which mark comes next.',
  'First-base line':'Click two clear points along the first-base line, spaced well apart. Follow the line itself.',
  'Continue to swing timing':'This hit can now be set up for use in matchup timing training.',
  'Choose the pitch video':'Choose a pitch recording that shows release and the ball reaching the area just in front of home plate. GameFrame will guide the timing marks.',
  'Clip start':'Set the clip start so release and the front-of-plate reference point are both inside the selected window, then continue.',
  'Pitch crop':'Keep enough of the field in view to see release and the ball approaching the plate. Preserve that wider view when setting the crop.',
  'Pitch contact':'Use a consistent contact point slightly in front of home plate, whether the pitch is hit, taken or missed. Choose the frame when the ball reaches that point.',
  'Review pitch speed':'Set release extension and the distance of the contact point in front of the plate. This example gives about eighty-three and a half miles per hour out of the hand, and seventy-nine and a half on average.',
  'Choose the saved swing':'Choose the saved swing with its timing tags. Its player, contact and timing information are already saved.',
  'Create the matchup':"Review the selected clips, then create the matchup. GameFrame aligns the pitch at the front-of-plate point with the swing's contact frame so you can compare timing.",
  'Existing matchup output':"Watch the swing start and commitment markers against the pitch. The pitch reaching the contact reference and the bat reaching contact share the same point on the timeline.",
  'Playback and download':'Download the finished video beside the player. Whatever task you choose, GameFrame guides you from beginning to end. Just follow the next instruction.'
 };
 for(const s of revised){if(copy[s.title])s.text=copy[s.title];if(s.title==='Review pitch speed')s.image_crop=[1200,410,120,0];delete s.index;delete s.caption_ass;delete s.caption_sha256;}
 const first=await brand(walk,'welcome','Guided walkthrough','Understand your\ngame video.','Exit velocity. Pitch speed. Swing timing.',path.join(prior,'guide/images/existing-ev-output.png'));
 const useful=await brand(walk,'measurements','Standalone measurements','Useful on\ntheir own.','Measure a hit or a pitch without creating a matchup.',path.join(prior,'guide/images/existing-pitch-output.png'));
 const match=await brand(walk,'matchups','A timing comparison','Or bring them\ntogether.','Compare a saved pitch with a tagged swing.',null);
 const guided=await brand(walk,'guided','GameFrame guides every step','You do not have\nto memorize it.','Read the next prompt. Make the mark. Continue.',path.join(root,'demo-output/home-actions/1440x900.png'));
 const intro=[
  {chapter:'Start here',title:'GameFrame guided walkthrough',images:[first],text:'GameFrame helps players show how their swing plays in real games, using video-based exit velocity estimates and pitch-speed measurements.'},
  {chapter:'Start here',title:'Standalone hit and pitch measurements',images:[useful],text:'Measure a hit to understand game contact. Measure a pitch to understand its speed. Either result is useful on its own.'},
  {chapter:'Start here',title:'Measurements and matchups',images:[match],text:'You can also combine a saved pitch with a tagged swing in a matchup. GameFrame puts their timing side by side.',...video(session.existing.matchup,9),source_duration_policy:'narration',brand_frame:match},
  {chapter:'Start here',title:'Follow the guided instructions',images:[guided],text:"You don't have to learn or memorize this workflow. GameFrame walks you through the entire process. Follow the on-screen instructions, one step at a time."}
 ];
 const walkthrough={title:'GameFrame — Guided Walkthrough',output_basename:'GameFrame-Guided-Walkthrough',kind:'walkthrough',captioned:true,expected_chapter_count:5,voice_scale:1.10,pitch_id:session.pitch_id,swing_id:session.swing_id,scenes:[...intro,...revised]};
 for(const story of [overviewStory,walkthrough]){
  if(story.scenes.some(s=>/cortland|grass|glove contact|bat contact for a hit/i.test(s.title+' '+s.text)))throw new Error('Outdated wording remains.');
  story.expected_source_titles=story.scenes.filter(s=>s.source_video).map(s=>s.title);
 }
 fs.writeFileSync(path.join(overview,'storyboard.json'),JSON.stringify(overviewStory,null,2));
 fs.writeFileSync(path.join(walk,'storyboard.json'),JSON.stringify(walkthrough,null,2));
 fs.writeFileSync(path.join(base,'voiceover-scripts.txt'),[overviewStory,walkthrough].map(story=>story.title+'\n\n'+story.scenes.map(s=>s.title+'\n'+s.text).join('\n\n')).join('\n\n'));
 await browser.close();console.log(JSON.stringify({overview_scenes:scenes.length,walkthrough_scenes:walkthrough.scenes.length,base}));
})().catch(e=>{console.error(e);process.exitCode=1});
