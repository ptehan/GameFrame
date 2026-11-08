const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/gameframe-polished'),folder=path.join(base,'hit-timing');
const session=JSON.parse(fs.readFileSync(path.join(root,'demo-output/cortland-double-85-wide/session.json')));
const guide=JSON.parse(fs.readFileSync(path.join(base,'walkthrough/timed-storyboard.json')));
const images=path.join(folder,'images');fs.mkdirSync(images,{recursive:true});
const source=title=>{const scene=guide.scenes.find(s=>s.title===title);if(!scene)throw Error(title);return scene.images;};
const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const logo='data:image/png;base64,'+fs.readFileSync(path.join(root,'static/logo/gameframe-logo-app.png')).toString('base64');
const feet=50,fast=80,slow=70,milliseconds=mph=>feet/(mph*5280/3600)*1000;
const fastMs=milliseconds(fast),slowMs=milliseconds(slow),gap=slowMs-fastMs;
const swingTimes=[650,700,750],swingRange=Math.max(...swingTimes)-Math.min(...swingTimes);
if(!(gap>60&&gap<62&&swingRange>gap))throw Error('Timing illustration arithmetic changed.');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 const page=await browser.newPage({viewport:{width:1280,height:654}});
 async function diagram(name,label,svg){
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#f1f6f2;color:#143c2b;font-family:Arial}header{height:92px;display:flex;align-items:center;justify-content:space-between;padding:24px 44px}header img{width:205px}header span{font-size:20px;font-weight:600}svg{display:block;width:1280px;height:562px}text{font-family:Arial;fill:#143c2b}.note{font-size:15px;fill:#526b5c}</style><header><img src="${logo}"><span>${label}</span></header>${svg}`);
  const file=path.join(images,name+'.png');await page.screenshot({path:file});return file;
 }
 const contactX=1090,scale=.92,startX=ms=>contactX-ms*scale;
 let comparisonBars='';
 for(const [label,ms,y,color] of [['80 mph average',fastMs,105,'#7d9d32'],['70 mph average',slowMs,155,'#7d9d32'],...swingTimes.map((ms,i)=>['Swing '+(i+1),ms,282+i*45,'#447eb0'])]){
  comparisonBars+=`<text x="50" y="${y+24}" font-size="22">${label}</text><rect x="${startX(ms)}" y="${y}" width="${ms*scale}" height="32" rx="7" fill="${color}"/><text x="${(startX(ms)+contactX)/2}" y="${y+24}" text-anchor="middle" style="fill:white;font-size:22px">${Math.round(ms)} ms</text>`;
 }
 let ticks='';for(const ms of [800,600,400,200,0])ticks+=`<line x1="${startX(ms)}" x2="${startX(ms)}" y1="475" y2="483" stroke="#72927f"/><text x="${startX(ms)}" y="507" text-anchor="middle" font-size="17">${ms}</text>`;
 const comparison=await diagram('timing-gap','Pitch flight and swing timing',`<svg viewBox="0 0 1280 562"><text x="50" y="35" class="note">Illustration: swing times are examples; pitch flight is over 50 ft at stated average speeds.</text><text x="50" y="82" font-size="20" font-weight="bold">Pitch flight</text><text x="50" y="245" font-size="20" font-weight="bold">Repeated swing timing</text><text x="50" y="269" font-size="17">First move to contact</text><text x="${contactX}" y="65" text-anchor="middle" font-size="21">Contact</text><line x1="${contactX}" x2="${contactX}" y1="76" y2="408" stroke="#143c2b" stroke-dasharray="6 5" stroke-width="2"/>${comparisonBars}<path d="M${startX(slowMs)} 204 v14 M${startX(slowMs)} 211 H${startX(fastMs)} M${startX(fastMs)} 204 v14" stroke="#52765e" stroke-width="2"/><text x="760" y="218" font-size="20">${Math.round(gap)} ms flight-time difference</text><path d="M${startX(750)} 426 v14 M${startX(750)} 433 H${startX(650)} M${startX(650)} 426 v14" stroke="#447eb0" stroke-width="2"/><text x="535" y="440" font-size="20">${swingRange} ms swing-time variation</text><line x1="330" x2="${contactX}" y1="475" y2="475" stroke="#72927f" stroke-width="2"/>${ticks}<text x="330" y="542" font-size="18">Milliseconds before contact · same scale for every bar</text></svg>`);
 const timeX=ms=>105+(ms+350)/900*1050,releaseX=timeX(0),interval=700;
 let bars='';
 for(const [index,speed,arrival] of [[0,fast,fastMs],[1,slow,slowMs]]){
  const row=190+index*190,start=timeX(arrival-interval),contact=timeX(arrival),barWidth=contact-start;
  bars+=`<text x="60" y="${row-66}" font-size="23">${speed} mph avg.</text><line x1="${releaseX}" x2="${contact}" y1="${row-38}" y2="${row-38}" stroke="#d0ad35" stroke-width="9"/><rect x="${start}" y="${row}" width="${barWidth}" height="34" rx="8" fill="#447eb0"/><text x="${start}" y="${row-12}" font-size="19">First move</text><line x1="${contact}" x2="${contact}" y1="${row-55}" y2="${row+50}" stroke="#143c2b" stroke-width="2"/><text x="${contact-44}" y="${row-69}" font-size="19">Contact</text><text x="${start+barWidth/2}" y="${row+25}" text-anchor="middle" style="fill:white;font-size:21px">700 ms</text>`;
 }
 const alignment=await diagram('same-movement','When to begin a repeatable movement',`<svg viewBox="0 0 1280 562"><line x1="${releaseX}" x2="${releaseX}" y1="70" y2="445" stroke="#52765e" stroke-width="2" stroke-dasharray="8 6"/><text x="${releaseX-54}" y="48" font-size="21">Pitch release</text>${bars}<rect x="80" y="477" width="24" height="12" rx="3" fill="#447eb0"/><text x="115" y="490" font-size="19">First move to contact, including preparation</text><rect x="735" y="477" width="24" height="12" rx="3" fill="#d0ad35"/><text x="770" y="490" font-size="19">Pitch flight</text><text x="70" y="540" class="note">Illustrative alignment: 700 ms movement, 50 ft travel, stated average pitch speeds. Not a timing prescription.</text></svg>`);
 const raw={source_video:session.source_path,source_sha256:sha(session.source_path),source_duration_s:25.157663,source_duration_policy:'narration'};
 const scenes=[
  {title:'A repeatable movement',images:source('Swing start'),text:"A faster pitcher doesn't mean you need to rush your swing. Build a repeatable movement, then learn when to begin against different velocities.",...raw},
  {title:'Tag the timing references',images:[...source('Swing start'),...source('Swing commitment'),...source('Contact')],text:'Tag the first move, commitment, and contact. Those intervals include your preparation, not just the bat moving forward. Use them as consistent reference points.'},
  {title:'Track your own swing over time',images:[...source('Choose the saved swing'),...source('Save swing timing')],text:'Record more swings. Compare the same timing intervals over time, and work with your coach toward a repeatable pattern. Your own history is the baseline.'},
  {title:'Pitch speed and your own timing variation',images:[comparison],text:'Pitchers change speeds to disrupt timing. Compare that flight-time difference with your own swing times. In this illustration, pitch flight times differ by about sixty milliseconds, while repeated first-move-to-contact times vary by a hundred milliseconds. Making your own movement more consistent is something you can work on.'},
  {title:'Change the start, not the pace',images:[alignment],text:'A repeatable first-move-to-contact interval gives you a starting point to study. Faster arrival means beginning that sequence earlier, rather than forcing it into less time.'},
  {title:'Study your matchup',images:source('Existing matchup output'),text:'Pair your measured pitch with a tagged swing. GameFrame aligns contact. Study when your first move should begin against that pitcher, while keeping your movement consistent.',source_video:session.existing.matchup.path,source_sha256:session.existing.matchup.sha256,source_duration_s:session.existing.matchup.duration_s},
  {title:'Practice and check the result',images:source('Review pitch speed'),text:'Use matchups to study the start, then test it in live swings and games. A video comparison is a training reference; your real repetitions tell you whether the timing is becoming more repeatable.',source_video:session.existing.pitch.path,source_sha256:session.existing.pitch.sha256,source_duration_s:session.existing.pitch.duration_s},
  {title:'Control what you can',images:source('Swing start'),text:"You cannot choose the pitcher's next pitch. You can control how you prepare, how you track your swing, and how consistently you move. Control what you can.",...raw}
 ].map(scene=>({chapter:'Control your timing',min_duration_s:8,voice_delay_s:.25,source_has_audio:false,...scene}));
 const story={title:'GameFrame — Control Your Timing',output_basename:'GameFrame-Hit-Timing',kind:'hit-timing',captioned:true,burn_narration_captions:true,voice_scale:1.10,expected_chapter_count:1,expected_source_titles:scenes.filter(s=>s.source_video).map(s=>s.title),scenes};
 fs.writeFileSync(path.join(folder,'storyboard.json'),JSON.stringify(story,null,2));
 fs.writeFileSync(path.join(folder,'voiceover-script.txt'),story.title+'\n\n'+scenes.map(s=>s.title+'\n'+s.text).join('\n\n'));
 fs.writeFileSync(path.join(folder,'content-notes.json'),JSON.stringify({purpose:'Coaching concept: track personal timing, seek repeatability, study the start against different velocities.',illustration:{distance_ft:feet,fast_average_mph:fast,slow_average_mph:slow,fast_arrival_ms:fastMs,slow_arrival_ms:slowMs,difference_ms:gap,swing_times_ms:swingTimes,swing_time_range_ms:swingRange,movement_interval_ms:interval,player_measurements:false},claims_not_made:['A population-wide prevalence of hitter errors exceeding fastball/changeup arrival gaps','Guaranteed performance improvement','Forward bat swing duration of 700 ms','Automatic longitudinal analytics or a new tracking feature'],research:[{url:'https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0230385',support:'Pitch information and movement timing affect batting timing; does not establish the prevalence comparison in this video.'}],public_scope:'No proprietary inference formulas, weights, or tuning details.'},null,2));
 await browser.close();console.log(JSON.stringify({folder,scenes:scenes.length,illustrative_gap_ms:gap}));
})().catch(error=>{console.error(error);process.exitCode=1});

