const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function autoFixture(){
 const calls=[];const c=vm.createContext({state:{contactTime:null,ballPathAudioStarted:false,videoFile:{}},activeWorkflowStep:'contact',els:{video:{readyState:1}}});
 vm.runInContext(source.slice(source.indexOf('function contactMarkingPrompt('),source.indexOf('function workflowFrameNavigationAllowed(')),c);
 c.suggestWorkflowContact=auto=>calls.push(auto);return {c,calls};
}
test('automatic suggestion starts on the contact screen once, not the later ball screen',()=>{
 const {c,calls}=autoFixture();c.ensureWorkflowContactSuggestion();c.ensureWorkflowContactSuggestion();assert.deepEqual(calls,[true]);
 c.state.ballPathAudioStarted=false;c.activeWorkflowStep='ballPath';c.ensureWorkflowContactSuggestion();assert.equal(calls.length,1);
});
test('opening existing contact never reruns the finder or moves saved marks',()=>{
 const {c,calls}=autoFixture();c.state.contactTime=1.5;c.ensureWorkflowContactSuggestion();assert.equal(calls.length,0);
});
test('automatic suggestion waits for video metadata',()=>{
 const {c,calls}=autoFixture();c.els.video.readyState=0;c.ensureWorkflowContactSuggestion();assert.equal(calls.length,0);
 c.els.video.readyState=1;c.ensureWorkflowContactSuggestion();assert.deepEqual(calls,[true]);
});
function audioFixture(){
 let finish;const gate=new Promise(resolve=>finish=resolve),seeks=[];let completed=false;
 const c=vm.createContext({state:{videoFile:{arrayBuffer:async()=>new ArrayBuffer(1)},contactTime:null},els:{video:{currentTime:.5},contactAudioStatus:{},contactAudioLeadFrames:{value:'1'},contactConfidence:{}},
  activeWorkflowStep:'contact',currentStep:()=>1/30,
  async analyzeSelectedVideoAudio(){await gate;completed=true;return{};},
  audioContactProposal:()=>({time:1-2/30,noiseTime:1,confidence:'HIGH',leadFrames:2}),
  async waitForVideoSeek(time){seeks.push(time);c.els.video.currentTime=time;},round:(n,p)=>Number(n.toFixed(p)),renderMetrics(){},renderOverlay(){}});
 vm.runInContext(source.slice(source.indexOf('async function detectContactFromAudio('),source.indexOf('function addObservation(')),c);
 return {c,finish,seeks,completed:()=>completed};
}
test('audio finder still jumps to the proposed contact when the user has not acted',async()=>{
 const f=audioFixture();const job=f.c.detectContactFromAudio({auto:true});f.finish();await job;
 assert.equal(f.seeks.length,1);assert.ok(Math.abs(f.seeks[0]-(1-2/30))<1e-9);assert.ok(f.completed());
});
for(const action of ['seek','tag','leave','new-video'])test('late audio suggestion respects user action: '+action,async()=>{
 const f=audioFixture(),job=f.c.detectContactFromAudio({auto:true});
 if(action==='seek')f.c.els.video.currentTime=2;
 if(action==='tag')f.c.state.contactTime=.5;
 if(action==='leave')f.c.activeWorkflowStep='landmarks';
 if(action==='new-video')f.c.state.videoFile={};
 f.finish();await job;assert.equal(f.seeks.length,0);assert.ok(f.completed());
});
