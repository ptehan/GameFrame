const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ev-predictor/app.js'),'utf8');
const fn=source.slice(source.indexOf('function nextPaint()'),source.indexOf('function supportedMp4MimeType()'));
test('nextPaint resolves when background animation frames never run',async()=>{
 const cancelled=[];
 const ctx=vm.createContext({setTimeout,clearTimeout,requestAnimationFrame:()=>42,cancelAnimationFrame:id=>cancelled.push(id)});
 vm.runInContext(fn,ctx);
 await Promise.race([ctx.nextPaint(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('stalled')),1000))]);
 assert.deepEqual(cancelled,[42]);
});
test('nextPaint normally waits for both paint callbacks',async()=>{
 const queue=[],cancelled=[];
 const ctx=vm.createContext({setTimeout,clearTimeout,requestAnimationFrame:cb=>{queue.push(cb);return queue.length;},cancelAnimationFrame:id=>cancelled.push(id)});
 vm.runInContext(fn,ctx);
 let complete=false;const promise=ctx.nextPaint().then(()=>{complete=true;});
 queue[0]();await Promise.resolve();assert.equal(complete,false);
 queue[1]();await promise;assert.equal(complete,true);assert.deepEqual(cancelled,[1,2]);
});
