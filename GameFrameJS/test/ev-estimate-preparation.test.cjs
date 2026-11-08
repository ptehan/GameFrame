const test=require('node:test'),assert=require('node:assert/strict');
const {createEstimatePreparation}=require('../static/js/ev-estimate-preparation');
test('one prepared request is reused; changed distance cannot receive an old estimate',async()=>{
  let finish;const calls=[];
  const prep=createEstimatePreparation((url,options)=>{calls.push(options);return new Promise(r=>finish=r)});
  const first=prep.prepare('geometry-A','distance-307',{distance:307});
  assert.equal(prep.prepare('geometry-A','distance-307',{}),first);
  assert.equal(prep.prepare('geometry-A','distance-312',{}),first);
  assert.equal(calls.length,1);
  assert.equal(prep.get('distance-312'),null);
  finish({ok:true,json:async()=>({speed:82})});
  assert.deepEqual(await prep.get('distance-307'),{speed:82});
});
test('changed contact/camera evidence cancels stale preparation',async()=>{
  const calls=[];
  const prep=createEstimatePreparation(async(url,options)=>{calls.push(options);return {ok:true,json:async()=>({})}});
  prep.prepare('A','A',{});const old=calls[0].signal;
  await prep.prepare('B','B',{});
  assert.equal(old.aborted,true);assert.equal(prep.get('A'),null);
  prep.cancel();assert.equal(calls[1].signal.aborted,true);
});
test('failed preparation remains a harmless miss for the normal request',async()=>{
  const prep=createEstimatePreparation(async()=>{throw Error('network unavailable')});
  assert.equal(await prep.prepare('A','A',{}),null);
  assert.equal(await prep.get('A'),null);
});
