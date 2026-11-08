const fs=require('fs'),path=require('path'),{spawn}=require('child_process');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'demo-output/why-matchups');fs.mkdirSync(folder,{recursive:true});
const texts=[
 ['why','A good swing can still be late. Or early. The question is: when does your swing need to begin against this pitcher? That is why matchups matter.'],
 ['pitch-speed','Pitch speed changes the time you have. In this example, a ball traveling fifty feet at an average of eighty miles an hour arrives about sixty milliseconds sooner than one averaging seventy. That difference matters.'],
 ['your-variation','But look at your own timing, too. These example swings take six hundred fifty, seven hundred, and seven hundred fifty milliseconds from first move to contact. That is a hundred milliseconds of variation, bigger than the pitch-speed difference we just saw. These are illustrations, not measurements of this hitter.'],
 ['repeatable','If your movement changes from swing to swing, pitch speed is only part of the problem. Work toward a repeatable movement, then study when to begin it against different pitchers.'],
 ['matchup','GameFrame puts a saved pitch and your tagged swing together, aligned at contact. Watch where your first move and commitment fall against the pitch. Compare that same swing with another pitcher, or compare different swings against the same pitch.'],
 ['closing','A matchup gives you something concrete to study with your coach. Take it into practice, then check it in games. See the timing. Work on consistency. Be ready for the next pitch. GameFrame.'],
];
const kind='why-matchups';
const plan={voice:'en-US-AndrewMultilingualNeural',rate:'-3%',paragraph_pause_s:.35,source_audit:'Original matchup concept script; illustrative arithmetic over 50 feet at constant stated average speed. Swing intervals are examples, not player measurements.',privacy_scope:'Generic product narration only; no footage, personal names, addresses or account data.',videos:[{kind,title:'Why Matchups Matter',paragraphs:texts.map(([id,text])=>({id,text}))}]};
fs.writeFileSync(path.join(folder,'narration-plan.json'),JSON.stringify(plan,null,2));
fs.writeFileSync(path.join(root,'output/video/GameFrame-Why-Matchups-Matter-Script.txt'),texts.map(([id,text])=>text).join('\r\n\r\n'));
if(!['assets','cards'].includes(process.argv[2]))process.exit(0);
const ffmpeg=require('ffmpeg-static');const run=args=>new Promise((resolve,reject)=>{const p=spawn(ffmpeg,args,{windowsHide:true});let err='';p.stderr.on('data',d=>err+=d);p.on('close',c=>c?reject(Error(err)):resolve());});
const logo='data:image/png;base64,'+fs.readFileSync(path.join(root,'static/logo/gameframe-logo-app.png')).toString('base64');
const common=`<style>*{box-sizing:border-box}body{margin:0;background:#f3f6f2;color:#173e32;font-family:Arial}header{height:130px;padding:36px 56px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #d7e1d6}header img{width:280px}header span{font-size:25px}main{padding:42px 56px}h1{font-size:54px;line-height:1.08;margin:0 0 24px;letter-spacing:-1.4px}p{font-size:31px;line-height:1.4;margin:18px 0;color:#426055}svg{width:1168px;height:540px}text{font-family:Arial;fill:#173e32}.small{font-size:23px;fill:#52695e}.big{font-size:38px;font-weight:bold}</style>`;
const ms=mph=>50/(mph*5280/3600)*1000,fast=ms(80),slow=ms(70),x=ms=>1090-ms*.94;
const chart=(rows,note)=>`<svg viewBox="0 0 1168 540"><text x="1090" y="38" text-anchor="end" font-size="26">CONTACT</text><line x1="1090" x2="1090" y1="55" y2="420" stroke="#173e32" stroke-width="3" stroke-dasharray="8 8"/>${rows.map(([label,t,color],i)=>{const y=100+i*100;return `<text x="0" y="${y+26}" font-size="27">${label}</text><rect x="${x(t)}" y="${y}" width="${t*.94}" height="40" rx="10" fill="${color}"/><text x="${x(t)+20}" y="${y+29}" style="fill:white;font-size:25px;font-weight:bold">${Math.round(t)} ms</text>`}).join('')}<text x="0" y="465" class="big">${note}</text><text x="0" y="514" class="small">Illustration • same time scale • animation shown slowly</text></svg>`;
(async()=>{const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');const browser=await chromium.launch({channel:'msedge',headless:true,args:['--no-proxy-server']});const page=await browser.newPage({viewport:{width:1280,height:960}});
const bodies=[
 `<h1 style="font-size:84px;margin-top:85px">Good swing.<br>Wrong time?</h1><p style="font-size:42px">See your swing against the pitch.</p><div style="margin-top:65px;width:100%;height:8px;background:#9aae40"></div><p>Why matchups matter</p>`,
 `<h1>Pitch speed changes arrival time.</h1><p>50 feet of travel at the stated average speed</p>${chart([['80 mph',fast,'#638c45'],['70 mph',slow,'#638c45']],'61 ms difference in pitch flight')}`,
 `<h1>Your timing can vary even more.</h1><p>First move to contact • three example swings</p>${chart([['Swing 1',650,'#337c9b'],['Swing 2',700,'#337c9b'],['Swing 3',750,'#337c9b']],'100 ms swing variation > 61 ms pitch difference')}`,
 `<h1>Repeat the movement.<br>Study when to start.</h1><p>Same 700 ms movement. Different pitch arrival.</p>${chart([['80 mph',700,'#337c9b'],['70 mph',700,'#337c9b']],'Study your first move relative to release').replace('</svg>',[fast,slow].map((t,j)=>`<line x1="${x(t)}" x2="${x(t)}" y1="${85+j*100}" y2="${150+j*100}" stroke="#e1b23a" stroke-width="5"/><text x="${x(t)}" y="${77+j*100}" text-anchor="middle" font-size="23">Release</text>`).join('')+'</svg>')} `,
 `<h1>Put your swing against the pitch.</h1><p>Aligned at contact • first move • commitment</p>`,
 `<img src="${logo}" style="width:650px;margin-top:75px"><h1 style="margin-top:70px">See the timing.<br>Work on consistency.</h1><p>Study a matchup with your coach.<br>Then take it into practice.</p>`
];
for(let i=0;i<bodies.length;i++){await page.setContent(`<!doctype html><meta charset="utf-8">${common}<header><img src="${logo}"><span>WHY MATCHUPS MATTER</span></header><main>${bodies[i]}</main>`);await page.screenshot({path:path.join(folder,`scene-${i}.png`)});}
await page.setContent('<body style="margin:0;background:transparent"><svg width="24" height="24"><circle cx="12" cy="12" r="10" fill="#f6c344" stroke="#173e32" stroke-width="3"/></svg>');await page.screenshot({path:path.join(folder,'dot.png'),omitBackground:true,clip:{x:0,y:0,width:24,height:24}});await browser.close();
if(process.argv[2]==='cards')return;
const narration=JSON.parse(fs.readFileSync(path.join(root,'demo-output/instruction-continuous/narration-microsoft',kind,'narration-manifest.json'))),scenes=[];
for(let i=0;i<bodies.length;i++){const duration=narration.paragraphs[i].duration_s+(i<5?narration.paragraph_pause_s:0),file=path.join(folder,`scene-${i}.mp4`);if(process.env.MATCHUP_REDO_SCENES&&!process.env.MATCHUP_REDO_SCENES.split(',').map(Number).includes(i)&&fs.existsSync(file)){scenes.push({file:path.relative(root,file).replaceAll('\\','/'),start:0,end:duration,zoom:1,maxRate:1});continue;}let args=['-y','-v','error','-loop','1','-framerate','30','-i',path.join(folder,`scene-${i}.png`)];let filter='[0:v]fps=30,format=yuv420p[v]';
if(i===1||i===2){args.push('-loop','1','-framerate','30','-i',path.join(folder,'dot.png'));const times=i===1?[fast,slow]:[650,700,750],split=times.map((_,j)=>`[d${j}]`).join('');filter=`[1:v]split=${times.length}${split};`;let last='0:v';times.forEach((t,j)=>{const next=j===times.length-1?'v':'a'+j;filter+=`[${last}][d${j}]overlay=x='${56+x(t)}+${t*.94}*min(1,mod(max(0,t-1),6)/4)':y=${130+42+58.32+24+43.4+18+100+j*100+8}:shortest=1[${next}];`;last=next;});filter=filter.slice(0,-1);}
if(i===4){args.push('-stream_loop','-1','-i',path.join(root,'demo-output/gameframe-20261106/assets/saved-matchup.mp4'));filter='[1:v]scale=1168:624:force_original_aspect_ratio=decrease,pad=1168:624:(ow-iw)/2:(oh-ih)/2:color=black[m];[0:v][m]overlay=56:320:shortest=1[v]';}
args.push('-filter_complex_threads','1','-filter_complex',filter,'-map','[v]','-an','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-threads','2',file);await run(args);scenes.push({file:path.relative(root,file).replaceAll('\\','/'),start:0,end:duration,zoom:1,maxRate:1});console.log('Animated scene '+i);}
fs.writeFileSync(path.join(folder,'edit-plan.json'),JSON.stringify({videos:[{kind,filename:'GameFrame-Why-Matchups-Matter.mp4',scenes}]},null,2));
fs.writeFileSync(path.join(folder,'arithmetic.json'),JSON.stringify({distance_ft:50,average_mph:[80,70],flight_ms:[fast,slow],flight_difference_ms:slow-fast,example_swing_ms:[650,700,750],swing_variation_ms:100,player_measurements:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});




