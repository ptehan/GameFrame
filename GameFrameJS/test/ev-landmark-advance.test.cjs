const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

test('last baseline click advances only when every required landmark is present', async () => {
  const source = fs.readFileSync(path.join(__dirname,'../ev-predictor/app.js'),'utf8');
  const start = source.indexOf('els.overlay.addEventListener("click", async');
  const end = source.indexOf('\n});',start) + 4;
  let listener;
  const steps = [];
  const landmarks = new Set();
  const required = ['home_plate','pitching_rubber','first_baseline_near','first_baseline_far','third_baseline_near','third_baseline_far'];
  const ctx = vm.createContext({
    els:{overlay:{addEventListener:(_,callback)=>listener=callback},video:{videoWidth:1280},clickMode:{value:'landmark'},setupModal:{open:true}},
    activeWorkflowStep:'landmarks', workflowLandmarkReview:false, wizardEditingActive:()=>true, displayToVideoPoint:()=>({x:1,y:2}),
    mark:required[0], addLandmark:()=>landmarks.add(ctx.mark),
    requiredVideoLandmarksReady:()=>required.every(mark=>landmarks.has(mark)),
    renderWorkflowStep:step=>steps.push(step), goToWorkflowStep:step=>steps.push(step),
  });
  vm.runInContext(source.slice(start,end),ctx);
  for(const mark of required){ctx.mark=mark;await listener({});}
  assert.deepEqual(steps,['landmarks','landmarks','landmarks','landmarks','landmarks','groundChoice']);
  landmarks.delete('pitching_rubber');
  await listener({});
  assert.equal(steps.at(-1),'landmarks');
});
