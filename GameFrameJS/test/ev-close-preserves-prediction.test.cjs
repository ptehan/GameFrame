const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
test('closing an unchanged editor preserves the valid prediction and marks',()=>{
 const prediction={ev_candidates:[{exit_velocity_mph:86}]};const state={latestPrediction:prediction,observations:[{image_x:123,image_y:234}]};let closed=false,saved=false;
 const c=vm.createContext({state,cancelWorkflowPrediction(){},restoreAfterSetupModal(){},els:{setupModal:{open:true,close(){closed=true;}}},updateEstimateBanner(){},persistDraft(){saved=true;},markPredictionStale(){throw new Error('Navigation must not discard the prediction');}});
 vm.runInContext(source.slice(source.indexOf('function closeSetupModal()'),source.indexOf('function hasActiveVideoSession()')),c);
 c.closeSetupModal();assert.equal(state.latestPrediction,prediction);assert.equal(state.observations[0].image_x,123);assert.ok(closed&&saved);
});
