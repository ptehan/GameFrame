const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('exact frames reuse the same source in flight and after completion, while another source fetches normally',async()=>{
 let requests=0,decodes=0;
 const ctx={window:{},location:{origin:'http://test'},setTimeout(){},Uint8Array,Blob,createImageBitmap:async()=>{decodes++;return{width:16,height:16};},fetch:async()=>{
  requests++;let read=false;
  return{ok:true,headers:{get:()=>1},body:{getReader:()=>({read:async()=>read?{done:true}:(read=true,{done:false,value:new Uint8Array([255,216,1,2,255,217])})})}};
 }};ctx.parent=ctx.window;vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/tag-frames.js'),'utf8'),ctx);
 const meta={fps:30,frame_count:1},a=ctx.window.GameFrameTagFrames.load('source-a',null,meta),b=ctx.window.GameFrameTagFrames.load('source-a');
 const [one,two]=await Promise.all([a,b]);assert.equal(one,two);assert.equal(requests,1);assert.equal(decodes,1);
 assert.equal(await ctx.window.GameFrameTagFrames.load('source-a'),one);assert.equal(requests,1);
 assert.equal(ctx.window.GameFrameTagFrames.metadata('source-a'),meta);
 await ctx.window.GameFrameTagFrames.load('source-b');assert.equal(requests,2);assert.equal(decodes,2);
});
test('a failed frame load is not reused on retry',async()=>{
 let attempts=0;const ctx={window:{},location:{origin:'http://test'},setTimeout(){},fetch:async()=>{attempts++;return{ok:false,text:async()=> 'decode failed'};}};ctx.parent=ctx.window;vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/js/tag-frames.js'),'utf8'),ctx);
 await assert.rejects(ctx.window.GameFrameTagFrames.load('bad'),/decode failed/);
 await assert.rejects(ctx.window.GameFrameTagFrames.load('bad'),/decode failed/);assert.equal(attempts,2);
});
