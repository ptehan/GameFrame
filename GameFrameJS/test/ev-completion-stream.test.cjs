const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('completion uses the saved local stream first and retains the legacy fallback',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ev-predictor/app.js'),'utf8');
 const fn=source.slice(source.indexOf('function showEvCompletion()'),source.indexOf('function openSavedSwingTiming('));
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{open:false,hidden:true,getAttribute(){return this.src},pause(){},close(){this.open=false},showModal(){this.open=true}});return nodes.get(id)};
 const context={state:{gameframe:{savedHitId:85,pendingSwingId:46}},document:{getElementById:get},clipBannerLines:()=>['EV 83 mph','LA 26 degrees','Distance 312 feet'],updateEvCompletionCopyStatus(){},openSharedLibrary(){},openSavedSwingTiming(){},window:{location:{}},encodeURIComponent};
 vm.runInNewContext(fn+';showEvCompletion();',context);
 const video=get('ev-complete-video');assert.equal(video.src,'/stream/ev-clip?id=85&kind=generated&inline=1');
 video.onerror();assert.equal(video.src,'/api/gameframe/ev-clip?id=85&kind=generated&inline=1');
 video.onerror();assert.match(get('ev-complete-notice').textContent,/Open Library/);assert.equal(get('ev-complete-modal').open,true);
});

test('pending completion plays the source, permits timing, and adopts the finished video without interrupting playback',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../ev-predictor/app.js'),'utf8');
 const fn=source.slice(source.indexOf('function showEvCompletion()'),source.indexOf('function openSavedSwingTiming('));
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{open:false,hidden:true,paused:false,ended:false,getAttribute(){return this.src},pause(){this.paused=true;this.onpause?.()},close(){this.open=false},showModal(){this.open=true}});return nodes.get(id)};
 let update,opened=null,cancelled=false;
 const context={state:{gameframe:{savedHitId:85,pendingSwingId:46,videoRenderStatus:'queued'}},stopEvVideoWatch:null,document:{getElementById:get},clipBannerLines:()=>['EV 83 mph','LA 26 degrees','Distance 312 feet'],updateEvCompletionCopyStatus(){},openSharedLibrary(){},openSavedSwingTiming:id=>opened=id,window:{location:{},GameFrameEvVideo:{watch:options=>{update=options.onStatus;return()=>cancelled=true}}},encodeURIComponent};
 vm.runInNewContext(fn+';showEvCompletion();',context);
 const video=get('ev-complete-video');assert.match(video.src,/kind=source/);assert.equal(get('ev-complete-download').disabled,true);assert.equal(get('ev-complete-metrics').hidden,false);
 update({status:'ready',pending_swing_id:46});assert.match(video.src,/kind=source/,'A playing source clip should not be interrupted');assert.equal(get('ev-complete-download').disabled,false);
 video.pause();assert.match(video.src,/kind=generated/);assert.equal(get('ev-complete-metrics').hidden,true,'Do not overlay another metrics caption on the finished video');
 get('ev-complete-timing').onclick();assert.equal(opened,46);assert.equal(cancelled,true);
});
