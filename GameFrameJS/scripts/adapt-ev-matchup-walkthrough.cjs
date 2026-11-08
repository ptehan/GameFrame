const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/instruction-continuous');
const original=JSON.parse(fs.readFileSync(path.join(base,'edit-plan.json')));
const previous=original.videos.find(v=>v.kind==='walkthrough').scenes;
const paragraphs=[
 ['introduction','This is a walkthrough of how to create a GameFrame Exit Velocity video and use that same swing in a Matchup.'],
 ['choose-video-and-hitter','Start with the Measure a hit for EV button and choose the original recording. Pick the team and hitter, then continue to the field map.'],
 ['map-the-field','Find the correct diamond at the chosen address. Mark the camera, home plate, second base, and landing. Put the landing mark where the ball first touched the ground, then choose how confident you are in that location.'],
 ['check-contact','GameFrame will suggest what it thinks is the contact frame. You can always override the suggestion. Click where the bat meets the ball.'],
 ['review-ball-path','Next, GameFrame will track the flight of the ball, marking it on its way. Choose Yes and continue if the path looks right. Otherwise, choose No to tag the ball flight manually.'],
 ['check-field-marks','GameFrame then auto-tags field landmarks. These are used to help the model understand the flight of the ball. If the marks are correct, choose Confirm field marks. Move the marks manually if need be.'],
 ['ground-contact','Next, decide whether first ground contact is visible. Hang time helps the model, but it is not required because it is often tough to see.'],
 ['review-estimate','GameFrame can now translate that ball path and compare it to our database of model flights. Review the estimated exit velocity, launch angle, and distance.'],
 ['save-and-tag-timing','Choose Save hit to keep the measurement and continue into the swing timing area. The exit velocity presentation video prepares in the background. Confirm the crop, then tag commitment and the first move. Contact from this hit is already carried forward.'],
 ['pitch-background','Here we will match up that swing with a saved pitch. Know that pitches are created from uploaded video, tagged at release and where the contact point would be in front of the plate, and cropped for presentation. Adjusting the distance from release to contact helps us calculate the speed of the pitch.'],
 ['create-matchup','Choose Create a matchup. Use the team and player filters to find your clips. Pick the saved pitch, continue, then choose the tagged swing to create the matchup.'],
 ['review-matchup','In the finished comparison, the clips align at contact. Watch where first movement and commitment fall against the pitch, then check the timing intervals. The same saved swing can be compared with another pitch.'],
 ['return-to-results','When the exit velocity video is ready, the notification includes View video. You can also return through View saved videos. Your measurement and timing work are saved, so you can review them or use the tagged swing in a matchup.'],
 ['closing','GameFrame helps showcase your best hits in real games and helps you be on time to have more of them to showcase — all for less than the price of one lesson.'],
].map(([id,text])=>({id,text}));
const kind='walkthrough-revised';
const narration={title:'EV video to Matchup — user-edited walkthrough',voice:'en-US-AndrewMultilingualNeural',rate:'-3%',paragraph_pause_s:.35,source_audit:'User-supplied revision; current app contactMarkingPrompt and existing continuous captures.',privacy_scope:'Product instructions only. No user names, footage, field addresses, account details or other personal content.',videos:[{kind,title:'Create an Exit Velocity Video and Use the Swing in a Matchup',paragraphs}]};
const home=original.videos.find(v=>v.kind==='overview').scenes[0];
const pitchFile='demo-output/instruction-continuous/pitch-session/pitch-matchup-continuous.webm';
const scenes=[
 {...home,end:home.start+8.5,zoom:1.2},
 {...previous[0],maxRate:2.1},previous[1],previous[2],previous[3],
 {...previous[4],start:199,zoom:1.6,zoomDelayFactor:0,zoomDelay:3,center:[.7,.65],panTo:[.76,.2],zoomReturn:2,panStart:.65,panEnd:.82,maxRate:1.6},
 previous[5],{...previous[6],end:237.712},
 {file:'demo-output/instruction-continuous/revised-handoff.mp4',start:0,end:33.52,zoom:1.1,center:[.55,.55],maxRate:2.1},
 {file:pitchFile,start:5.479,end:226.8,omit:[[10.5,98.8],[111.5,209],[218.6,221.8]],grayscale:true,maxRate:1.8},
 previous[12],previous[13],previous[14],
 {file:'demo-output/gameframe-20261106/assets/saved-ev.mp4',start:24,end:31,maxRate:1.3},
];
const edit={basis:'User-authored EV-to-matchup sequence. Pitch creation is a separate monochrome background aside, using complete recorded app frames.',same_swing_evidence:{ev_hit_id:103,swing_clip_id:132,pitch_clip_id:69,source_database:'demo-output/instruction-continuous/tutorial-snapshot.db'},videos:[{kind,filename:'GameFrame-EV-to-Matchup-Walkthrough.mp4',scenes}]};
const menuFolder='demo-output/instruction-continuous/current-menu-final';
const menu=JSON.parse(fs.readFileSync(path.join(root,menuFolder,'events.json')));
if(menu.errors.length)throw Error('Current menu capture failed');
const at=label=>{const event=menu.events.find(e=>e.label===label);if(!event)throw Error('Missing menu event '+label);return event.seconds;};
const menuFile=menuFolder+'/current-menu.webm';
scenes[0]={file:menuFile,start:at('current-home'),end:at('current-home')+7,zoom:1};
scenes[1]={file:menuFile,start:at('current-choose-video')-1.5,end:at('current-field-address')+1.5,maxRate:1.5,zoom:1};
scenes[2]={file:previous[1].file,start:previous[1].start,end:previous[1].end,zoom:1,maxRate:2};
scenes[3]={file:previous[2].file,start:93.8,end:102.4,zoom:1.25,center:[.67,.62],maxRate:1.2};
scenes[12]={file:menuFile,start:at('current-home-before-library'),end:at('current-ev-player')+.5,maxRate:1.5,zoom:1};
scenes[13]={file:'demo-output/gameframe-20261106/assets/saved-ev.mp4',start:30.8,end:31.04,zoom:1};
edit.videos[0].filename='GameFrame-EV-to-Matchup-Walkthrough-Four-Points.mp4';
edit.videos[0].full_playbacks=[{after_index:12,file:'demo-output/gameframe-20261106/assets/saved-ev.mp4'}];
fs.writeFileSync(path.join(base,'narration/revised-walkthrough-plan.json'),JSON.stringify(narration,null,2));
fs.writeFileSync(path.join(base,'revised-walkthrough-edit-plan.json'),JSON.stringify(edit,null,2));
const script=paragraphs.map(p=>p.text).join('\r\n\r\n')+'\r\n';
fs.writeFileSync(path.join(root,'output/video/GameFrame-Full-Walkthrough-Script.txt'),script);
fs.writeFileSync(path.join(root,'output/video/GameFrame-EV-to-Matchup-Script.txt'),script);
console.log(JSON.stringify({paragraphs:paragraphs.length,words:script.split(/\s+/).filter(Boolean).length,kind,pitch_aside_index:9}));

