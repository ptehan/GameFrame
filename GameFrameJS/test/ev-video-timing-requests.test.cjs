const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function setup(){
 const requests=[];const context={state:{videoFile:{name:'test.mp4',size:20},videoMetadata:{},frameTimes:[],contactTime:null},els:{video:{currentTime:2.1}},currentStep:()=>1/30,setFrameStepFromMetadata(){},syncTimeline(){},setTimeout(){},fetch:(url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),resolve}))};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let videoTimingRequest=0'),source.indexOf('function currentFrameIndex()')),context);
 function finish(index,reference=2){requests[index].resolve({ok:true,json:async()=>({frame_times_s:Array.from({length:21},(_,i)=>reference+i/30),fps:30})})}
 return {context,requests,finish};
}
test('nearby concurrent requests share exact timing and reuse the covered window',async()=>{
 const {context:c,requests:r,finish}=setup();const a=c.refreshVideoTiming(2.1),b=c.refreshVideoTiming(2.2);assert.equal(r.length,1);finish(0);await Promise.all([a,b]);await c.refreshVideoTiming(2.3);assert.equal(r.length,1);assert.equal(c.state.videoTimingBusy,false);
});
test('a different uncovered window is fetched after the pending one finishes',async()=>{
 const {context:c,requests:r,finish}=setup();const a=c.refreshVideoTiming(2.1),b=c.refreshVideoTiming(4.1);finish(0);await a;await new Promise(setImmediate);assert.equal(r.length,2);finish(1,4);await b;assert.equal(r[1].body.reference_time_s,4.1);
});
test('a timing result from a replaced video cannot overwrite the new video',async()=>{
 const {context:c,requests:r,finish}=setup();const a=c.refreshVideoTiming(2.1);c.state.videoFile={name:'other.mp4',size:30};const b=c.refreshVideoTiming(4.1);finish(0);await a;assert.equal(c.state.frameTimes.length,0);finish(1,4);await b;assert.equal(c.state.frameTimes[0],4);
});
