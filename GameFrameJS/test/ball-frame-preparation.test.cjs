const test=require('node:test'),assert=require('node:assert/strict');
const {createFramePreparation}=require('../static/js/ball-frame-preparation.js');
test('reuse numbered preloaded frames when confirmed contact has dense early coverage',async()=>{
 const prepare=createFramePreparation(),video={};let loads=0;
 const session={id:'preloaded',times:Array.from({length:60},(_,i)=>1+i/30),frameNumbers:Array.from({length:60},(_,i)=>30+i),launchFrameCount:35};
 await prepare(video,1,30,async()=>{loads++;return session;});
 const reused=await prepare(video,1.4,30,async()=>{throw Error('must reuse');});
 assert.equal(reused,session);assert.equal(reused.frameNumbers[12],42);assert.equal(loads,1);
 await prepare(video,2.5,30,async prior=>{assert.equal(prior.id,'preloaded');loads++;return {id:'replacement'};});
 assert.equal(loads,2);
});
test('reuse only raw frames for the same video, contact frame and cadence',async()=>{
 const prepare=createFramePreparation(),video={},other={};let loads=0;
 const load=async()=>({session:++loads});
 const [a,b]=await Promise.all([prepare(video,2,30,load),prepare(video,2,30,load)]);
 assert.deepEqual(a,b);assert.equal(loads,1);
 assert.deepEqual(await prepare(video,2,30,load),a);
 await prepare(video,2.033,30,load);assert.equal(loads,2);
 await prepare(other,2.033,30,load);assert.equal(loads,3);
 await prepare(other,2.033,60,load);assert.equal(loads,4);
});
test('failed or cancelled preparation can be retried',async()=>{
 const prepare=createFramePreparation(),video={};let loads=0;
 await assert.rejects(prepare(video,2,30,async()=>{loads++;throw Error('cancelled');}));
 assert.equal(await prepare(video,2,30,async()=>++loads),2);
});
test('an aborted in-flight request cannot poison a replacement request',async()=>{
 const prepare=createFramePreparation(),video={},controller=new AbortController();let failOld;
 const old=prepare(video,2,30,()=>new Promise((resolve,reject)=>{failOld=reject;}),controller.signal);
 const oldRejected=assert.rejects(old);
 await Promise.resolve();controller.abort();
 const replacement=await prepare(video,2,30,async()=>({session:'replacement'}));
 failOld(Error('aborted'));await oldRejected;
 assert.equal((await prepare(video,2,30,async()=>{throw Error('must reuse replacement');})).session,replacement.session);
});

test('reuse raw frames across nominal/actual FPS rounding when native coverage is sufficient', async()=>{
  const prepare=createFramePreparation();const identity={};let loads=0;
  const session={launchFrameCount:40,times:Array.from({length:100},(_,i)=>i/60)};
  const load=async()=>{loads++;return session};
  await prepare(identity,0,59.94,load);
  assert.equal(await prepare(identity,.1,60,load),session);
  assert.equal(loads,1);
});
