const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ev-predictor/app.js'),'utf8');
const fn=source.slice(source.indexOf('function setTerminalEvent('),source.indexOf('function renderTerminalEvent()'));
function mark(fps,value=''){
 const context={state:{contactUncertaintyS:1/(2*fps)},els:{terminalUncertaintyFrames:{value},uncertainty:{value:30},pointSource:{value:'HUMAN'},pointConfidence:{value:'HIGH'}},displayedFrameTime:()=>5,frameIntervalAt:()=>1/fps,currentStep:()=>1/fps,relativeTime:t=>t-2,round:(v,n)=>Math.round(v*10**n)/10**n,markPredictionStale(){},renderTerminalEvent(){},renderOverlay(){},persistDraft(){}};
 vm.runInNewContext(fn+';setTerminalEvent();',context);return context.state.terminalEvent;
}
test('manual ground default is half a frame at 30 and 60 fps; duration includes both endpoint errors',()=>{
 for(const fps of [30,60]){const e=mark(fps);assert.equal(e.landing_time_uncertainty_s,1/(2*fps));assert.ok(Math.abs(e.timing_uncertainty_s-1/fps)<.000001);assert.equal(e.image_x,null);assert.equal(e.video_time_s,5);}
});
test('an explicitly wider ground uncertainty remains available',()=>{assert.equal(mark(60,'2').landing_time_uncertainty_s,2/60);});
test('ground precision cannot claim better than half-frame quantization',()=>{assert.equal(mark(30,'0.1').landing_time_uncertainty_s,1/60);});
