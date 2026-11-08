const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('ev-predictor/app.js', 'utf8');
function fixture() {
  const calls = [];
  const state = {latestPrediction:{method:"existing"},contactTime: 2, terminalEvent: {video_time_s: 4.6}, observations: [{x:1,y:2}], landmarks:[{x:3,y:4}]};
  const c = vm.createContext({state, calls, workflowPreparingExport:false, workflowExportRunning:false,
    activeWorkflowStep:"landmarks",backgroundPredictionPromise:null,workflowReviewRequested:false,workflowError:"",actualMapConfirmBusy:false, workflowMapSnapshot:'same', signature:'same', ready:true, field:true, map:true,
    els:{actualFieldMapModal:{open:false}},
    ballDetectionSeedReadiness(){return {ready:c.ready};}, requiredVideoLandmarksReady(){return c.field;},
    actualFieldMapGeometryReady(){return c.map;}, workflowMapSignature(){return c.signature;},
    cancelWorkflowPrediction(){calls.push('cancel');}, openSetupModal(step){calls.push(step);},
    goToWorkflowStep(step){calls.push(step);c.activeWorkflowStep=step;}, closeActualFieldMapModal(){calls.push('close-map');},
    async applyActualFieldMapValues(){calls.push('apply-map'); return c.applied !== false;},
    seekVideoTo(time){calls.push(time);},
    async startBackgroundPrediction(){calls.push("prediction");c.state.latestPrediction={method:"new-review"};return c.state.latestPrediction;},
  });
  vm.runInContext(source.slice(source.indexOf('function workflowNavigationItems()'), source.indexOf('function renderWorkflowNavigation(')), c);
  return c;
}
test('completed screens can be revisited and returned to review without changing marks', async () => {
  const c=fixture(), before=JSON.stringify(c.state);
  for(const step of ['ballPath','landmarks','contact','ground','player']) await c.navigateWorkflow(step);
  assert.equal(JSON.stringify(c.state),before);
  assert.deepEqual(c.calls.filter(x=>typeof x==='string' && x!=='cancel'),['ballPath','landmarks','contact','ground','player']);
  assert.ok(c.calls.includes(4.6));
});
test('missing required marks disable dependent screens',async()=>{
  const c=fixture(); c.field=false;
  await c.navigateWorkflow('player'); assert.equal(c.calls.length,0);
  c.ready=false; await c.navigateWorkflow('landmarks'); assert.equal(c.calls.length,0);
  assert.equal(c.workflowNavigationItems().find(x=>x.step==='ballPath').enabled,true);
});
test('map browsing skips saving unchanged marks but applies corrections before returning',async()=>{
  const c=fixture(); c.els.actualFieldMapModal.open=true;
  await c.navigateWorkflow('player'); assert.deepEqual(c.calls,['cancel','close-map','player']);
  c.calls.length=0; c.signature='changed';
  await c.navigateWorkflow('player'); assert.deepEqual(c.calls,['cancel','apply-map','player']);
  c.calls.length=0; c.applied=false;
  await c.navigateWorkflow('player'); assert.deepEqual(c.calls,['cancel','apply-map']);
});
test('navigation cannot interrupt export or map confirmation',async()=>{
  for(const flag of ['workflowPreparingExport','workflowExportRunning','actualMapConfirmBusy']) {
    const c=fixture(); c[flag]=true; await c.navigateWorkflow('contact'); assert.equal(c.calls.length,0);
  }
});

test('Review builds a missing prediction without creating or saving a video',async()=>{
 const c=fixture();c.state.latestPrediction=null;
 await c.navigateWorkflow('player');
 assert.deepEqual(c.calls,['cancel','player','prediction']);
 assert.equal(c.workflowReviewRequested,true);assert.equal(c.state.latestPrediction.method,'new-review');
});
test('Review reuses an in-progress prediction instead of restarting it',async()=>{
 const c=fixture();c.activeWorkflowStep='player';c.state.latestPrediction=null;
 c.backgroundPredictionPromise=Promise.resolve('running-review');
 assert.equal(await c.navigateWorkflow('player'),'running-review');assert.equal(c.calls.length,0);
});
