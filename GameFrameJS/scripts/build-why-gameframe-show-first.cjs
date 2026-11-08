const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'demo-output/why-gameframe-show-first');fs.mkdirSync(dir,{recursive:true});
const paragraphs=[
 ['summary-timing','GameFrame helps you measure your hits in real games and train your timing against different pitchers.'],
 ['summary-games','Upload a clip of a hit from a real game. GameFrame estimates exit velocity, launch angle, and distance, then creates a video with your hit and those numbers together. Here is why that matters.'],
 ['measure','Coaches need ways to compare players. Numbers from a cage, a tee, or a machine are easier to collect than numbers from games. Swing mechanics can be measured, too. So those things get a lot of attention. But easy to measure does not mean the whole story.'],
 ['timing','What about timing? Does your swing take the same amount of time each time? Can you get it started at the right moment against different pitchers? A strong swing needs to be on time.'],
 ['practice','GameFrame lets you put your swing against different saved pitches. See when you start. See when you commit. Use those matchups to practice your timing, and compare your tagged swing times to work on consistency.'],
 ['games','Then bring it back to the game. Use your game video to estimate how hard you hit the ball, its launch angle, and how far it traveled. Show what you can do against real pitching.'],
 ['close','Train your timing. Work on a repeatable swing. Show your results when it matters. GameFrame.'],
].map(([id,text])=>({id,text}));
const kind='why-gameframe-show-first',plan={paragraph_pause_s:.35,source_audit:'Summary, explanation, summary. Actual matchup and EV footage first; approved closing retained. Simple explanation of the quantitative fallacy and current GameFrame workflows.',privacy_scope:'Generic product script only; no personal data, names, addresses, account data or footage.',videos:[{kind,title:'Why GameFrame',paragraphs}]};
fs.writeFileSync(path.join(dir,'narration-plan.json'),JSON.stringify(plan,null,2));
fs.writeFileSync(path.join(root,'output/video/GameFrame-Why-GameFrame-Show-First-Script.txt'),paragraphs.map(p=>p.text).join('\r\n\r\n'));
fs.writeFileSync(path.join(dir,'content-notes.json'),JSON.stringify({idea:'McNamara fallacy: easily measured quantities can receive attention while important harder-to-measure factors receive too little.',sources:[{url:'https://files.eric.ed.gov/fulltext/ED111814.pdf',purpose:'Quantitative fallacy background'},{url:'https://www.patrickjonesbaseball.com/blog/think-you-need-a-100-mph-showcase-exit-velocity',purpose:'Coach discussion of showcase numbers and performance against live pitching'}],product_scope:'Compare tagged swing intervals; study saved-pitch matchups and practice timing. Game-hit metrics are estimates. No automatic consistency dashboard or guaranteed performance claim.'},null,2));
if(process.argv[2]!=='render')process.exit(0);
const ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
const run=(exe,args)=>new Promise((resolve,reject)=>{const p=spawn(exe,args,{windowsHide:true});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err=(err+d).slice(-10000));p.on('error',reject);p.on('close',c=>c?reject(Error(err)):resolve(out));});
(async()=>{
 const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const logo='data:image/png;base64,'+fs.readFileSync(path.join(root,'static/logo/gameframe-logo-app.png')).toString('base64');
 if(!process.env.WHY_SKIP_CARDS){const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});const page=await browser.newPage({viewport:{width:1280,height:960}});
 const bodies=[
  `<h1>Train your timing.</h1><p>Build consistency against different pitching.</p>`,
  `<h1>Show it in games.</h1><p>Your hit. Real pitching.</p>`,
  `<h1>Easy to measure.<br>Easy to focus on.</h1><div class="tiles"><div>Hit power</div><div>Swing mechanics</div></div><p class="callout">Useful numbers.<br>Part of the story.</p>`,
  `<h1>The missing piece?<br>Timing.</h1><div class="question"><b>1</b> Can you repeat your swing time?</div><div class="question"><b>2</b> Can you adjust to the pitcher?</div>`,
  `<h1>Practice your timing.</h1><p>Different pitches. Your swing.</p>`,
  `<h1>Show it in a game.</h1><p>Estimated exit velocity · launch angle · distance</p>`,
  `<img class="hero-logo" src="${logo}"><h1 style="font-size:67px">Train your timing.<br>Build consistency.<br>Show it in games.</h1>`,
 ];
 const css=`*{box-sizing:border-box}body{margin:0;background:#f3f6f2;color:#173e32;font-family:Arial}header{height:118px;padding:30px 54px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #dce4da}header img{width:265px}header span{font-size:24px}main{padding:40px 54px}h1{font-size:72px;letter-spacing:-2px;line-height:1.12;margin:0 0 30px}p{font-size:32px;line-height:1.4;color:#456256;margin:18px 0}.hero-logo{width:600px;margin:50px 0 68px}.tiles{display:flex;gap:24px;margin-top:60px}.tiles div{flex:1;background:#e0eadb;padding:48px 30px;font-size:37px;border-radius:14px}.callout{margin-top:55px;font-size:44px}.question{font-size:37px;margin-top:65px;display:flex;align-items:center;gap:25px}.question b{display:inline-flex;width:68px;height:68px;border-radius:50%;background:#9eaf43;align-items:center;justify-content:center}`;
 for(let i=0;i<bodies.length;i++){await page.setContent(`<!doctype html><meta charset="utf-8"><style>${css}</style><header><img src="${logo}"><span>WHY GAMEFRAME</span></header><main>${bodies[i]}</main>`);await page.screenshot({path:path.join(dir,`scene-${i}.png`)});}await browser.close();}
 const narration=JSON.parse(fs.readFileSync(path.join(root,'demo-output/instruction-continuous/narration-microsoft',kind,'narration-manifest.json')));let expected=0;const parts=[];
 for(let i=0;i<paragraphs.length;i++){
  const audio=narration.paragraphs[i],duration=audio.duration_s+(i<paragraphs.length-1?narration.paragraph_pause_s:0),file=path.join(dir,`part-${i}.mp4`);expected+=duration;
  if(i===1&&process.env.WHY_OPENING_ONLY&&fs.existsSync(file)){parts.push(file);continue;}
  if(i>=2){const old=JSON.parse(fs.readFileSync(path.join(root,'demo-output/instruction-continuous/narration-microsoft/why-gameframe/narration-manifest.json')));const index=old.paragraphs.findIndex(p=>p.text===audio.text&&p.wav_sha256===audio.wav_sha256&&p.duration_s===audio.duration_s);if(index<0)throw Error('Unchanged scene narration does not match');fs.copyFileSync(path.join(root,'demo-output/why-gameframe',`part-${index}.mp4`),file);parts.push(file);console.log('Reused unchanged scene '+(i+1));continue;}
  const args=['-y','-v','error','-loop','1','-framerate','30','-i',path.join(dir,`scene-${i}.png`)];let filter='[0:v]fps=30,format=yuv420p[v]',audioInput=1;
  const media={0:'saved-matchup.mp4',1:'saved-ev.mp4',4:'saved-matchup.mp4',5:'saved-ev.mp4'};
  if(media[i]){args.push('-stream_loop','-1');if(i===0)args.push('-ss','3.2');args.push('-i',path.join(root,'demo-output/gameframe-20261106/assets',media[i]));filter='[1:v]scale=1172:624:force_original_aspect_ratio=decrease,pad=1172:624:(ow-iw)/2:(oh-ih)/2:color=black[m];[0:v][m]overlay=54:320:shortest=1,fps=30,format=yuv420p[v]';audioInput=2;}
  args.push('-i',audio.wav,'-filter_complex_threads','1','-filter_complex',filter,'-map','[v]','-map',`${audioInput}:a:0`,'-af',`apad,atrim=duration=${duration}`,'-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-ar','48000',file);
  await run(ffmpeg,args);parts.push(file);console.log('Rendered Why GameFrame '+(i+1)+'/'+paragraphs.length);
 }
 const list=path.join(dir,'concat.txt');fs.writeFileSync(list,parts.map(p=>`file '${p.replaceAll('\\','/')}'`).join('\n'));
 const final=path.join(root,'output/video/GameFrame-Why-GameFrame-Show-First.mp4'),staged=final.replace('.mp4','.working.mp4');
 await run(ffmpeg,['-y','-v','error','-f','concat','-safe','0','-i',list,'-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=9','-c:a','aac','-b:a','160k','-movflags','+faststart',staged]);
 const info=JSON.parse(await run(ffprobe,['-v','error','-show_format','-show_streams','-of','json',staged]));if(Math.abs(Number(info.format.duration)-expected)>.2)throw Error('Duration mismatch');
 await run(ffmpeg,['-v','error','-threads','1','-i',staged,'-f','null','-']);fs.renameSync(staged,final);
 let cursor=0;const srt=[],stamp=t=>{const n=Math.round(t*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
 for(const [i,a] of narration.paragraphs.entries()){const words=a.text.split(/\s+/);for(let j=0;j<words.length;j+=8)srt.push(`${srt.length+1}\n${stamp(cursor+a.duration_s*j/words.length)} --> ${stamp(cursor+a.duration_s*Math.min(j+8,words.length)/words.length)}\n${words.slice(j,j+8).join(' ')}\n`);cursor+=a.duration_s+(i<paragraphs.length-1?narration.paragraph_pause_s:0);}fs.writeFileSync(final.replace('.mp4','.srt'),srt.join('\n'));
 fs.writeFileSync(path.join(dir,'ready.json'),JSON.stringify({file:final,duration_s:Number(info.format.duration),expected_duration_s:expected,decode_errors:0,voice:narration.voice,script:paragraphs,source_notes:'content-notes.json'},null,2));console.log('Ready '+final);
})().catch(e=>{console.error(e);process.exitCode=1});
