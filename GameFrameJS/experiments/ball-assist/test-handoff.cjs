const {test}=require('node:test'),assert=require('node:assert/strict');
const {prepare}=require('../../static/js/ball-assist-handoff.js');
const payload=()=>({version:1,accepted:true,session:{width:200,height:100,fps:30,times:[.8,.833333,.866667,.9]},contact:{frame:1,x:50,y:60},points:[{frame:2,x:70,y:40},{frame:3,x:90,y:20}]});
test('acceptance preserves measured frame times and scales image points without inventing marks',()=>{
 const p=payload(),before=JSON.stringify(p),result=prepare(p,400,200);
 assert.equal(JSON.stringify(p),before);assert.equal(result.contactTime,.833333);assert.equal(result.observations.length,3);
 assert.equal(result.observations[0].source,'HUMAN');assert.equal(result.observations[1].source,'COMPUTER_VISION');
 assert.equal(result.observations[1].human_reviewed,true);assert.equal(result.observations[1].image_x,140);
 assert.ok(Math.abs(result.observations[2].relative_time_s-.066667)<1e-6);
});
test('manual fallback carries contact only and discards every detected flight point',()=>{
 const p=payload();p.accepted=false;p.points.push({frame:999,x:NaN,y:NaN});const result=prepare(p,200,100);
 assert.equal(result.accepted,false);assert.equal(result.observations.length,1);assert.equal(result.observations[0].role,'CONTACT_POINT');
});
test('empty or invalid accepted detections cannot advance as a valid path',()=>{
 const p=payload();p.points=[];assert.throws(()=>prepare(p,200,100),/No detected/);
 p.points=[{frame:2,x:500,y:10}];assert.throws(()=>prepare(p,200,100),/Invalid ball point/);
});
