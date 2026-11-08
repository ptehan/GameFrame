const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
 const requests=[],timers=[],updates=[],errors=[];
 const window={fetch:()=>new Promise(resolve=>requests.push(resolve))};
 vm.runInNewContext(fs.readFileSync('static/js/ev-video-ready.js','utf8'),{window,setTimeout:fn=>{timers.push(fn);return fn},clearTimeout:fn=>{const index=timers.indexOf(fn);if(index>=0)timers.splice(index,1)}});
 const cancel=window.GameFrameEvVideo.watch({id:1,onStatus:status=>updates.push(status),onError:error=>errors.push(error)});
 const respond=async(status,code=200)=>{requests.shift()({ok:code===200,status:code,json:async()=>status});await new Promise(setImmediate)};
 return {requests,timers,updates,errors,cancel,respond};
}
test('poll pending work and stop when the video is ready',async()=>{
 const s=setup();await s.respond({status:'rendering'});assert.equal(s.updates.length,1);s.timers.shift()();await s.respond({status:'ready'});assert.equal(s.updates.length,2);assert.equal(s.timers.length,0);
});
test('closing the viewer discards an in-flight status response',async()=>{
 const s=setup();s.cancel();await s.respond({status:'ready'});assert.equal(s.updates.length,0);assert.equal(s.timers.length,0);
});
test('a deleted hit stops polling instead of displaying an endless loading state',async()=>{
 const s=setup();await s.respond({error:'Saved hit not found'},404);assert.equal(s.errors[0].status,404);assert.equal(s.timers.length,0);
});
