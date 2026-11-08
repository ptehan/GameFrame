// Exercise real dialog controls with estimation isolated; never save library data.
const assert=require('node:assert/strict');
const {chromium}=require('C:/Users/Patrick/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--enable-features=CDPScreenshotNewSurface']});
 try{
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:8000/ev/predictor.html');
  await page.waitForFunction(()=>typeof goToWorkflowStep==='function');
  await page.evaluate(()=>{
   renderWorkflowStep=step=>{activeWorkflowStep=step;els.setupModal.dataset.step=step;};
   applyActualFieldMapValues=async()=>{els.actualFieldMapModal.close();return true;};
   startBackgroundPrediction=()=>Promise.resolve(null);
   actualMapStage='review';
   els.actualFieldMapModal.showModal();
   els.actualMapContinue.disabled=false;
  });
  await page.locator('#actual-map-continue').click();
  await page.waitForFunction(()=>els.setupModal.open&&activeWorkflowStep==='player'&&!landingReviewSaving);
  assert.equal(await page.locator('#setup-modal').isVisible(),true,'Review must reopen after map confirmation');
  for(const fail of [false,true]){
   await page.evaluate(fail=>{
    state.latestPrediction={distance_review:{required:true}};
    els.setupControlsSlot.innerHTML='<button id="review-recalculate">Recalculate</button><div id="workflow-prediction-working" hidden><progress id="workflow-prediction-progress-bar"></progress><span id="workflow-prediction-working-text"></span></div>';
    runLivePrediction=()=>new Promise((resolve,reject)=>{window.finishTestEstimate=()=>fail?reject(new Error('Test estimation failure')):resolve({});});
    setupDistanceReview();
   },fail);
   await page.locator('#review-recalculate').click();
   assert.equal(await page.locator('#workflow-prediction-working').isVisible(),true,'Recalculation progress must be visible');
   await page.evaluate(()=>finishTestEstimate());
   await page.waitForFunction(()=>!document.getElementById('workflow-prediction-working').hidden||workflowError);
   assert.equal(await page.evaluate(()=>workflowError),fail?'Test estimation failure':'');
   assert.equal(await page.locator('#setup-modal').isVisible(),true);
  }
  console.log('PASS: landing revision restores review; recalculation progress and errors remain visible.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
