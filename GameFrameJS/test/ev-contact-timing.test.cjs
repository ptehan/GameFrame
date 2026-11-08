const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function fixture(){
 const c=vm.createContext({presentedVideoFrame:null,state:{contactTime:null,contactTimingChoice:'BETWEEN_FRAMES',frameStepS:1/30,frameTimes:[1,1+1/30,1.1],observations:[{video_time_s:1.1},{video_time_s:1.4}],terminalEvent:{video_time_s:3,landing_time_uncertainty_s:.04}},
  els:{video:{currentTime:1.1,currentSrc:'fixture.mp4'}}, currentStep:()=>1/30,round:(x,p)=>Number(x.toFixed(p)),stopNativeBallAssist(){},scheduleContactPreload(){},markPredictionStale(){},renderMetrics(){},renderObservations(){},renderApexEvent(){},persistDraft(){}});
 vm.runInContext(source.slice(source.indexOf('function displayedFrameTime('),source.indexOf('let videoTimingRequest=')),c);
 vm.runInContext(source.slice(source.indexOf('function contactCalibrationTime('),source.indexOf('async function detectContactFromAudio(')),c);
 return c;
}
test('between-frame contact uses actual adjacent timestamps for variable frame spacing',()=>{
 const c=fixture();c.setContactFromDisplayedFrame();
 assert.ok(Math.abs(c.state.contactTime-((1+1/30+1.1)/2))<1e-9);
 assert.equal(c.state.contactFrameTime,1.1);
 assert.equal(c.state.observations[0].video_time_s,1.1);
 assert.ok(Math.abs(c.state.observations[0].relative_time_s-1/30)<1e-6);
 assert.ok(Math.abs(c.state.terminalEvent.relative_time_s-(3-c.state.contactTime))<1e-6);
 assert.ok(Math.abs(c.state.terminalEvent.timing_uncertainty_s-(.04+1/30))<1e-6);
});
test('on-frame contact uses the displayed image timestamp, not a fractional seek target',()=>{
 const c=fixture();c.state.contactTimingChoice='ON_FRAME';c.els.video.currentTime=1.11;c.setContactFromDisplayedFrame();
 assert.equal(c.state.contactTime,1.1);assert.equal(c.contactCalibrationTime(),1.1);
});
test('fractional contact has an explicit fallback for declared constant frame rate',()=>{
 const c=fixture();c.state.frameTimes=[];c.els.video.currentTime=2;c.setContactFromDisplayedFrame();
 assert.ok(Math.abs(c.state.contactTime-(2-1/60))<1e-9);
 assert.equal(c.state.contactFrameTime,2);
});
test('restoring observations preserves actual timestamps and timing roles',()=>{
 const c=fixture();vm.runInContext(source.slice(source.indexOf('function normalizeObservationRows('),source.indexOf('function normalizeLandmarkRows(')),c);
 const row={video_time_s:2,relative_time_s:1/60,image_x:100,image_y:200,role:'CONTACT_POINT',contact_timing_mode:'BETWEEN_FRAMES',source:'HUMAN'};
 const restored=c.normalizeObservationRows([row])[0];
 assert.equal(restored.role,row.role);assert.equal(restored.contact_timing_mode,row.contact_timing_mode);assert.equal(restored.video_time_s,2);
});

test('between-frame contact cannot refer to a nonexistent frame before the start',()=>{
 const c=fixture();c.state.frameTimes=[];c.els.video.currentTime=0;c.setWorkflowVideoPrompt=()=>{};
 assert.equal(c.setContactFromDisplayedFrame(),false);assert.equal(c.state.contactTime,null);
});
