const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../ev-predictor/app.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function lineResponseAt('),source.indexOf('function lineExitProgressPixels(')),context);
function scan(ranges){
 const width=80,height=20,response=new Float32Array(width*height);
 for(const [start,end,strength=100] of ranges)for(let x=start;x<=end;x++)response[10*width+x]=strength;
 return context.farthestLineStreak(response,width,height,0,10,1,0,3,60);
}
test('a streak touching the upper search edge does not manufacture a ball endpoint',()=>{
 assert.equal(scan([[0,79]]),null);
 assert.equal(scan([[50,79]]),null);
 assert.equal(scan([[15,20],[50,79]]),null,'A nearer blob must not replace an unresolved farther streak.');
});
test('a fully observed streak end remains eligible and empty images remain untracked',()=>{
 const hit=scan([[15,20],[35,40]]);
 assert.ok(hit&&hit.progress>=40&&hit.progress<=43);assert.equal(hit.evidence,100);
 assert.equal(scan([]),null);assert.equal(scan([[20,30,2]]),null);
});
