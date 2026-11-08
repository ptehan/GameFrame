const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createEvWorker}=require('../ev-worker.js');
async function scenario(route){
 const messages=[],child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
 child.stdin=new EventEmitter();child.stdin.write=(line,done)=>{messages.push(JSON.parse(line));done?.();};
 const worker=createEvWorker({root:process.cwd(),databasePath:'unused.sqlite',spawnProcess:()=>child});
 const res=new EventEmitter();res.writableEnded=false;res.destroyed=false;
 const pending=worker.handle({originalUrl:route,method:'POST',body:{}},res,error=>{throw error;});
 const deadline=Date.now()+3000;while(!messages.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,5));
 assert.equal(messages.length,1);res.destroyed=true;res.emit('close');
 const cancel=messages.find(m=>m.method==='CANCEL');
 if(route==='/api/predict')assert.equal(cancel?.id,messages[0].id);
 else assert.equal(cancel,undefined,'Disconnect must not cancel a durable save');
 child.stdout.write(JSON.stringify({id:messages[0].id,status:200,headers:{}})+'\n');
 await pending;worker.stop();
}
test('disconnect cancels the exact prediction job',()=>scenario('/api/predict'));
test('disconnect leaves saved-hit work running',()=>scenario('/api/gameframe/save-hit'));
