const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function fixture(fps){
 const c=vm.createContext({state:{contactTime:2},els:{video:{videoWidth:1280,duration:20}},currentStep:()=>1/fps,
 contactCalibrationTime:()=>2,adjacentFrameTime:n=>2+n/fps,marks:[]});
 c.manualBallObservations=()=>c.marks;
 vm.runInContext(source.slice(source.indexOf('function ballAnchorFrameGap()'),source.indexOf('function acceptAutoTrack(')),c);
 vm.runInContext(source.slice(source.indexOf('function ballDetectionSeedReadiness()'),source.indexOf('function syncDetectFlightButtons(')),c);
 return c;
}
for(const fps of [30,60,59.94]) test(`optional marks continue indefinitely at ${fps} fps`,()=>{
 const c=fixture(fps),scale=fps>50?2:1;
 c.marks.push({role:'CONTACT_POINT',video_time_s:2,relative_time_s:0});
 assert.equal(c.ballDetectionSeedReadiness().ready,false);
 for(let nominal=10;nominal<=60;nominal+=5){
  const pending=c.ballDetectionSeedReadiness();
  assert.equal(pending.frameGap,nominal*scale);
  assert.equal(pending.ready,nominal>10);
  c.marks.push({video_time_s:2+nominal*scale/fps,relative_time_s:nominal*scale/fps});
  assert.equal(c.ballDetectionSeedReadiness().ready,true);
 }
 assert.equal(c.ballDetectionSeedReadiness().markKey,'flight65');
});
test('Not visible advances without coordinates; continuing is available after first pair',()=>{
 const c=fixture(30);c.marks.push({role:'CONTACT_POINT',video_time_s:2,relative_time_s:0});
 c.state.skippedVideoMarks=[];
 for(let nominal=10;nominal<=40;nominal+=5){
  assert.equal(c.ballDetectionSeedReadiness().markKey,`flight${nominal}`);
  c.state.skippedVideoMarks.push(`flight${nominal}`);
  assert.equal(c.ballDetectionSeedReadiness().ready,true);
 }
 assert.equal(c.marks.length,1);
});
test('mark prompts stop at the end of the source video',()=>{
 const c=fixture(30);c.els.video.duration=2.5;
 c.marks.push({role:'CONTACT_POINT',video_time_s:2,relative_time_s:0});
 c.state.skippedVideoMarks=['flight10','flight15'];
 assert.equal(c.ballDetectionSeedReadiness().phase,'end_of_video');
 assert.equal(c.ballDetectionSeedReadiness().ready,true);
 assert.equal(c.ballDetectionSeedReadiness().markKey,undefined);
});
