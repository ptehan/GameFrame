const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ev-predictor/app.js'),'utf8');
function extract(name){
  const at=source.indexOf(`function ${name}(`),start=source.slice(at-6,at)==='async '?at-6:at;
  let depth=0;
  for(let i=source.indexOf('{',at);i<source.length;i++){
    if(source[i]==='{')depth++;
    if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(name);
}
function setup(){
  const calls={builds:[],saves:[],progress:[]};
  const ctx=vm.createContext({state:{latestPrediction:{ev_candidates:[{hit_id:'best',exit_velocity_mph:76},{hit_id:'second',exit_velocity_mph:80}]},fileName:'swing.mp4',contactTime:2,gameframe:{}},
    preparedClipBuild:null,pendingMapEvidence:Promise.resolve(),description:'First',hitterId:1,window:{location:{}},
    evSaveCompletionMessage:()=> 'EV video saved.',predictionExportBlocker:()=>null,needsLandingReview:()=>false,setClipProgress:(...args)=>calls.progress.push(args),
  });
  ctx.buildPackage=()=>({hit:{description:ctx.description,gameframe_hitter_id:ctx.hitterId,gameframe_team_id:1},ball_observations:[{relative_time_s:0},{relative_time_s:1/3}]});
  ctx.clipBannerLines=()=>[ctx.description,'EV 76 mph'];
  ctx.startBackgroundPrediction=async()=>ctx.state.latestPrediction;
  ctx.buildClippedVideo=async payload=>{calls.builds.push(payload);return {job_id:'job-'+calls.builds.length,download_url:'/download/'+calls.builds.length};};
  ctx.saveHitTrack=async data=>calls.saves.push({...data,hitter:ctx.hitterId,description:ctx.description});
  for(const name of ['clipBuildPayload','prepareClippedVideo','downloadClippedVideo','practicalEstimate'])vm.runInContext(extract(name),ctx);
  return {ctx,calls};
}
test('prepares immediately, deduplicates work, then saves with the earlier player metadata',async()=>{
  const {ctx,calls}=setup();
  await Promise.all([ctx.prepareClippedVideo(),ctx.prepareClippedVideo()]);
  assert.equal(calls.builds.length,1);assert.equal(calls.saves.length,0);
  assert.equal(ctx.window.location.href,undefined);
  assert.equal(await ctx.downloadClippedVideo(),true);
  assert.equal(calls.builds.length,1);assert.equal(calls.saves[0].hitter,1);
  assert.equal(calls.saves[0].clipJobId,'job-1');
});
test('description changes during rendering cannot save a stale title',async()=>{
  const {ctx,calls}=setup();let release,notifyStarted;
  const started=new Promise(resolve=>notifyStarted=resolve);
  ctx.buildClippedVideo=async payload=>{
    calls.builds.push(payload);
    if(calls.builds.length===1)await new Promise(resolve=>{release=resolve;notifyStarted();});
    return {job_id:'job-'+calls.builds.length,download_url:'/download'};
  };
  const pending=ctx.prepareClippedVideo();await started;
  assert.equal(typeof release,'function');ctx.description='Final description';release();await pending;
  await ctx.downloadClippedVideo();
  assert.equal(calls.builds.length,2);
  assert.equal(calls.builds[1].package.hit.description,'Final description');
  assert.equal(calls.saves[0].clipJobId,'job-2');
});
test('failed builds retry and failed saves do not download or report success',async()=>{
  const {ctx,calls}=setup();
  ctx.buildClippedVideo=async()=>{throw new Error('encode failed');};
  await assert.rejects(ctx.prepareClippedVideo(),/encode failed/);
  assert.equal(ctx.preparedClipBuild,null);
  ctx.buildClippedVideo=async()=>({job_id:'ready',download_url:'/download'});
  ctx.saveHitTrack=async()=>{throw new Error('save failed');};
  assert.equal(await ctx.downloadClippedVideo(),false);assert.equal(ctx.window.location.href,undefined);
});
test('headline uses the saved best row, not an average of neighboring candidates',()=>{
  const {ctx}=setup();assert.equal(ctx.practicalEstimate().exit_velocity_mph,76);assert.equal(ctx.practicalEstimate().hit_id,'best');
});

test('distance review blocks rendering and saving until the user reviews the mark',async()=>{
  const {ctx,calls}=setup();
  ctx.needsLandingReview=()=>true;
  await assert.rejects(ctx.prepareClippedVideo(),/Review the landing direction/);
  assert.equal(calls.builds.length,0);
  assert.equal(await ctx.downloadClippedVideo(),false);
  assert.equal(calls.saves.length,0);
  ctx.needsLandingReview=()=>false;
  assert.equal(await ctx.downloadClippedVideo(),true);
  assert.equal(calls.builds.length,1);
});
