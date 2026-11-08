const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ev-predictor/app.js'),'utf8');
const fn=source.slice(source.indexOf('async function runWorkflowExport()'),source.indexOf('async function continueWorkflow()'));
for(const delayed of [false,true])test('saved EV opens swing timing without a playback stop'+(delayed?' after timing copy preparation':''),async()=>{
 const events=[],state={gameframe:{}};
 const context={state,workflowExportRunning:false,workflowExportComplete:false,workflowError:'',activeWorkflowStep:'player',
  els:{setupContinue:{classList:{add(){}}},setupModal:{open:false}},setClipProgress(){},nextPaint:async()=>{},
  startWorkflowSaveProgress:()=>({stage(){},stop(){}}),
  saveHitTrack:async options=>{assert.equal(options.deferVideo,true);state.gameframe.savedHitId=41;state.gameframe.videoRenderStatus='queued';if(delayed)state.gameframe.copyReadyPromise=Promise.resolve().then(()=>{state.gameframe.pendingSwingId=52;});else state.gameframe.pendingSwingId=52;return{measurement_persisted:true};},
  evSaveCompletionMessage:()=>'',closeSetupModal:()=>events.push('close'),
  window:{GameFrameEvVideoNotifications:{track:(id,status)=>events.push(['notice',id,status])},GameFrameEvDrafts:{clear:async()=>events.push('clear')}},
  openSavedSwingTiming:id=>events.push(['timing',id]),openSharedLibrary:()=>assert.fail('Unexpected Library fallback'),
  showEvCompletion:()=>assert.fail('Must not open playback'),loadSavedHits:()=>assert.fail('Must not wait for Library reload')};
 vm.createContext(context);await vm.runInContext(fn+';runWorkflowExport()',context);
 assert.deepEqual(events,[['notice',41,'queued'],'clear','close',['timing',52]]);
});

test('a slow timing copy shows its own stage and keeps the dialog visible until ready',async()=>{
 let finish,stageReached;const stageReady=new Promise(r=>stageReached=r),events=[],state={gameframe:{}};
 const c={state,workflowExportRunning:false,workflowExportComplete:false,workflowError:'',activeWorkflowStep:'player',
  els:{setupContinue:{classList:{add(){}}},setupModal:{open:false}},setClipProgress(){},nextPaint:async()=>{},
  startWorkflowSaveProgress:()=>({stage:text=>{events.push(text);stageReached();},stop:()=>events.push('stopped')}),
  saveHitTrack:async()=>{state.gameframe.savedHitId=41;state.gameframe.videoRenderStatus='queued';state.gameframe.copyReadyPromise=new Promise(r=>finish=()=>{state.gameframe.pendingSwingId=52;r();});return{measurement_persisted:true};},
  evSaveCompletionMessage:()=>'',closeSetupModal:()=>events.push('closed'),
  window:{GameFrameEvVideoNotifications:{track(){}},GameFrameEvDrafts:{clear:async()=>{}}},
  openSavedSwingTiming:id=>events.push(id),openSharedLibrary:()=>assert.fail('Must retain timing handoff')};
 vm.createContext(c);const pending=vm.runInContext(fn+';runWorkflowExport()',c);await stageReady;
 assert.equal(c.els.setupContinue.textContent,'Preparing swing timing...');assert.equal(events.includes('closed'),false);
 assert.match(events[0],/^Hit saved\./);finish();await pending;
 assert.deepEqual(events.slice(1),['closed',52,'stopped']);
});

test('save progress reports elapsed time without inventing a percentage and stops its timer',()=>{
 let tick,now=0,cleared=false;const progress=[];
 const c=vm.createContext({Date:{now:()=>now},setInterval:fn=>(tick=fn,7),clearInterval:id=>{assert.equal(id,7);cleared=true;},setClipProgress:(value,text)=>progress.push({value,text})});
 vm.runInContext(source.slice(source.indexOf('function startWorkflowSaveProgress()'),source.indexOf('async function runWorkflowExport()')),c);
 const job=c.startWorkflowSaveProgress();assert.equal(progress[0].value,null);now=4000;tick();assert.match(progress.at(-1).text,/4 seconds/);
 job.stage('Hit saved. Preparing swing timing.');assert.equal(progress.at(-1).text,'Hit saved. Preparing swing timing.');job.stop();assert.equal(cleared,true);
});
