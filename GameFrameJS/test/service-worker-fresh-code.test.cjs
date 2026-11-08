const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
 const handlers={},calls=[];
 const self={location:{origin:'http://127.0.0.1:8000'},addEventListener:(n,f)=>handlers[n]=f,skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 vm.runInNewContext(fs.readFileSync('static/service-worker.js','utf8'),{self,URL,Response,caches:{open:async()=>({match:async()=>new Response('heavy cached')})},fetch:async(req,opts)=>{calls.push(opts);return new Response('fresh');}});
 return {handlers,calls};
}
test('EV code and styles always fetch fresh without HTTP caching',async()=>{
 const {handlers,calls}=setup();
 for(const path of ['/ev/app.js','/ev/styles.css','/static/css/styles.css','/']){
  let result;handlers.fetch({request:{url:'http://127.0.0.1:8000'+path,method:'GET',mode:path==='/'?'navigate':'cors',headers:new Headers()},respondWith:p=>result=p});
  assert.equal(await (await result).text(),'fresh');
 }
 assert.equal(calls.length,4);assert.ok(calls.every(c=>c.cache==='no-store'));
});
test('heavy runtime reuses cache; APIs and external map tiles bypass worker',async()=>{
 const {handlers,calls}=setup();let result;
 handlers.fetch({request:{url:'http://127.0.0.1:8000/static/js/ffmpeg/ffmpeg-core.js',method:'GET',headers:new Headers()},respondWith:p=>result=p});
 assert.equal(await (await result).text(),'heavy cached');assert.equal(calls.length,0);
 for(const url of ['http://127.0.0.1:8000/api/predict','https://maps.example/tile']) handlers.fetch({request:{url,method:'GET'},respondWith:()=>assert.fail('must bypass')});
});
