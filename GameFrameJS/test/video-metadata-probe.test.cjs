const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('server.js','utf8'),fn=source.slice(source.indexOf('function ffprobeMeta('),source.indexOf('function swingEventSeconds('));
function fixture(results){const calls=[];const c=vm.createContext({calls,Buffer,parseFraction:v=>{const[a,b=1]=String(v).split('/').map(Number);return a/b;},normalizedVideoDate:v=>v||null,runCmd:(cmd,args)=>{calls.push(args);return{stdout:Buffer.from(JSON.stringify(results.shift()))};}});vm.runInContext(fn,c);return c;}
test('upload metadata needs no full decode and keeps rate, duration and creation date',()=>{
 const c=fixture([{streams:[{avg_frame_rate:'60000/1001',nb_frames:'180',tags:{creation_time:'2026-11-08'}}],format:{duration:'3.003'}}]);
 const m=c.ffprobeMeta('original.mp4',{countFrames:false});assert.equal(c.calls.length,1);assert.equal(c.calls[0].includes('-count_frames'),false);assert.equal(m.frameCount,180);assert.equal(m.fps,60000/1001);assert.equal(m.duration,3.003);assert.equal(m.creationTime,'2026-11-08');
});
test('frame-index trimming uses container frame counts without decoding the full source',()=>{
 const c=fixture([{streams:[{avg_frame_rate:'30/1',nb_frames:'91',duration:'3'}]}]);
 assert.equal(c.ffprobeMeta('original.mp4',{countFrames:false,requireExactFrameCount:true}).frameCount,91);assert.equal(c.calls[0].includes('-count_frames'),false);
});
test('frame-index trimming falls back to an exact count when the container has none',()=>{
 const c=fixture([{streams:[{avg_frame_rate:'30/1',duration:'3'}]},{streams:[{avg_frame_rate:'30/1',duration:'3',nb_read_frames:'89'}]}]);
 assert.equal(c.ffprobeMeta('original.mp4',{countFrames:false,requireExactFrameCount:true}).frameCount,89);assert.equal(c.calls.length,2);assert.equal(c.calls[1].includes('-count_frames'),true);
});
test('tagging and finalization still request exact frame counts by default',()=>{
 const c=fixture([{streams:[{avg_frame_rate:'60/1',nb_read_frames:'119',duration:'2'}]}]);assert.equal(c.ffprobeMeta('short.mp4').frameCount,119);assert.equal(c.calls[0].includes('-count_frames'),true);
});
