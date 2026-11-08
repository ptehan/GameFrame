const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'demo-output/instruction-continuous');
const read=kind=>JSON.parse(fs.readFileSync(path.join(dir,'recordings',kind,'events.json')));
const ev=read('walkthrough-final'),timing=read('timing-final'),home=read('overview');
const map=read('map-crosshairs');
const pitch=JSON.parse(fs.readFileSync(path.join(dir,'pitch-session/recording-complete.json')));
const pitchProbe=JSON.parse(fs.readFileSync(path.join(dir,'pitch-session/video-probe.json')));
const pitchOffset=pitch.events.find(e=>e.label.startsWith('Closing browser context')).seconds-pitchProbe.duration_s;
const t=(record,label)=>{const value=record.events.find(e=>e.label===label)?.seconds;if(!Number.isFinite(value))throw Error('Missing captured event '+label);return value;};
const E=n=>t(ev,n),T=n=>t(timing,n),H=n=>t(home,n);
const M=n=>t(map,n),P=name=>{const c=pitch.checkpoints.find(c=>c.name===name);if(!c)throw Error('Missing pitch checkpoint '+name);return c.seconds-pitchOffset;};
const ef='demo-output/instruction-continuous/recordings/walkthrough-final/normalized.webm';
const tf='demo-output/instruction-continuous/recordings/timing-final/normalized.webm';
const hf='demo-output/instruction-continuous/recordings/overview/continuous.webm';
const saved='demo-output/gameframe-20261106/assets/saved-ev.mp4';
const matchup='demo-output/gameframe-20261106/assets/saved-matchup.mp4';
const pf='demo-output/instruction-continuous/pitch-session/pitch-matchup-continuous.webm';
const mf='demo-output/instruction-continuous/recordings/map-crosshairs/continuous.webm';
const scene=(file,start,end,extra={})=>({file,start,end,...extra});
const videos=[
 {kind:'overview',filename:'GameFrame-Overview-Continuous.mp4',scenes:[
  scene(hf,H('choose-task'),H('choose-task')+13,{zoom:1.35,center:[.45,.35]}),
  scene(ef,E('review-field-marks'),E('corrected-field-marks')+6,{zoom:1.95,center:[.72,.7],panTo:[.3,.7],maxRate:2.8}),
  scene(matchup,0,15.9)]},
 {kind:'walkthrough',filename:'GameFrame-Guided-Walkthrough-Continuous.mp4',scenes:[
  scene(ef,E('choose-video')-1,E('field-address')+2,{maxRate:1.6}),
  scene(mf,M('map-the-field')-18,M('map-the-field')+3,{zoom:1.7,center:[.5,.48],panTo:[.8,.35]}),
  scene(ef,E('check-contact')+1,E('detect-ball-path')+.5,{zoom:2,center:[.28,.8],panTo:[.72,.6],maxRate:2.5}),
  scene(ef,E('review-ball-path'),E('review-field-marks')-.4,{zoom:1.12,center:[.5,.5],maxRate:1.6}),
  scene(ef,E('review-field-marks'),E('first-ground-contact')+.1,{zoom:2.05,zoomDelayFactor:.65,zoomReturn:2,panStart:.70,panEnd:.85,center:[.72,.7],panTo:[.37,.7],maxRate:2.2}),
  scene(ef,E('first-ground-contact'),E('prediction-review')-.2),
  scene(ef,E('prediction-review'),E('save-hit')+3,{zoom:1.7,center:[.28,.3],panTo:[.73,.3]}),
  scene(tf,T('set-crop'),T('first-move')+15,{omit:[[T('set-crop')+1,T('set-crop')+5],[T('commitment')+5,T('commitment')+9],[T('first-move')+5,T('first-move')+8]],maxRate:2.3,zoom:1.1,center:[.55,.55]}),
  scene(pf,P('01-pitch-upload'),P('04-clip-start')+2,{zoom:1.3,zoomReturn:1.5,center:[.3,.35],maxRate:1.8}),
  scene(pf,P('06-crop')-4,P('07-contact-frame-119')+3,{zoom:1.5,zoomReturn:1.5,center:[.5,.55]}),
  scene(pf,P('08-distance-and-speed-range'),P('11-review-pitch-speed')-2,{omit:[[210-pitchOffset,216-pitchOffset]],zoom:2.7,zoomDelay:1.8,zoomOut:2,zoomReturn:3,panStart:.35,panEnd:.65,center:[.18,.36],panTo:[.62,.36],maxRate:1.8}),
  scene(pf,P('11-review-pitch-speed'),P('12-saved-pitch-library')+2,{zoom:1.4,center:[.25,.28],padAtStart:.8}),
  scene(pf,P('13-matchup-pitch-69')-1,P('15-matchup-review-no-submit')+2.5,{zoom:1.25,zoomReturn:2,center:[.4,.4],maxRate:1.8}),
  scene(matchup,0,15.9),
  scene(hf,H('saved-videos'),H('saved-videos')+9,{zoom:2,center:[.25,.25]})]},
 {kind:'hit-timing',filename:'GameFrame-Swing-Timing-Continuous.mp4',scenes:[
  scene(hf,H('choose-task'),H('choose-task')+13,{zoom:1.35,center:[.45,.35]}),
  scene(tf,T('set-crop')-2,T('commitment')-.2,{zoom:1.15,center:[.5,.48]}),
  scene(tf,T('commitment'),T('first-move')+20,{zoom:1.65,center:[.78,.7],maxRate:2.2}),
  scene(matchup,0,15.9)]},
 {kind:'technical',filename:'GameFrame-Technical-Explainer-Continuous.mp4',scenes:[
  scene(ef,E('corrected-field-marks')-5,E('corrected-field-marks')+7,{zoom:1.8,center:[.65,.7]}),
  scene(saved,3,15),
  scene(saved,16,30.8),
  scene(ef,E('prediction-review'),E('save-hit')+.2,{zoom:1.7,center:[.28,.3],panTo:[.73,.3]})]},
];
const plan={basis:'Actual continuous Playwright captures of the current app, plus unchanged saved EV and matchup playback. Trimmed processing waits; no pasted UI pieces or fabricated field overlays.',recording_database:'demo-output/instruction-continuous/tutorial-snapshot.db',field_reference:'demo-output/instruction-continuous/field-reference.json',known_capture_tail:'The EV take reached the actual crop editor after Save hit; the recorder then timed out on an intermediate redirect URL. That unused timeout tail is excluded. Timing is recorded separately from the resulting pending swing. Unencoded capture tails are excluded; saved playback uses the verified original files.',videos};
fs.writeFileSync(path.join(dir,'edit-plan.json'),JSON.stringify(plan,null,2));console.log('Planned '+videos.length+' videos.');
