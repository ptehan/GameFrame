const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function fixture(){
 const manual={index:1,video_time_s:1,relative_time_s:0,image_x:100,image_y:120,source:'HUMAN',role:'CONTACT_POINT'};
 const c=vm.createContext({state:{observations:[manual],autoObservations:[],showAutoTrack:true},nativeBallAssist:{generation:0,phase:'review',points:[{...manual,source:'COMPUTER_VISION'},{video_time_s:1.1,relative_time_s:.1,image_x:140,image_y:90,source:'COMPUTER_VISION'}]},els:{showAutoTrack:{},autoTrackStatus:{},setupModal:{open:true}},calls:[],fetch:()=>Promise.resolve(),
  renderObservations(){},renderOverlay(){},persistDraft(){},markPredictionStale(){},contactCalibrationTime:()=>1,currentStep:()=>1/30,
  isManualBallObservation:o=>o.source==='HUMAN',observationFrameKey:o=>Math.round(o.video_time_s*30),reindexRows:rows=>rows.forEach((r,i)=>r.index=i+1),goToWorkflowStep:step=>c.calls.push(step)});
 vm.runInContext(source.slice(source.indexOf('function stopNativeBallAssist('),source.indexOf('function renderNativeBallAssist(')),c);
 vm.runInContext(source.slice(source.indexOf('function acceptAutoTrack('),source.indexOf('function clearAutoTrack(')),c);
 return c;
}
test('accepting native flight preserves manual contact and detector provenance before field review',()=>{
 const c=fixture();c.acceptNativeBallAssist();
 assert.equal(c.state.observations.length,2);assert.equal(c.state.observations[0].source,'HUMAN');assert.equal(c.state.observations[0].role,'CONTACT_POINT');
 assert.equal(c.state.observations[1].source,'COMPUTER_VISION');assert.equal(c.state.observations[1].human_reviewed,true);
 assert.equal(c.state.ballAssistAccepted,true);assert.equal(c.state.detectionAccepted,true);assert.deepEqual([...c.calls],['landmarks']);
});
test('rejecting native flight enters manual tagging without removing the contact mark',()=>{
 const c=fixture();c.state.autoObservations=[...c.nativeBallAssist.points];c.useRegularIntervalTagging();
 assert.equal(c.nativeBallAssist.phase,'manual');assert.equal(c.state.autoObservations.length,0);assert.equal(c.state.observations.length,1);
 assert.equal(c.state.observations[0].video_time_s,1);assert.equal(c.state.ballAssistAccepted,false);assert.deepEqual([...c.calls],['ballPath']);
});
