const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {renderStoryboard}=require('./render-cortland-walkthrough.cjs');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/gameframe-instructions-refresh');
(async()=>{
 const p=spawnSync(path.join(root,'.venv-ev/Scripts/python.exe'),[path.join(__dirname,'finalize-instruction-refresh.py')],{cwd:root,windowsHide:true,stdio:'inherit'});
 if(p.status!==0)throw Error('Instruction frame/caption preparation failed');
 const kinds=['overview','walkthrough','hit-timing','technical'];
 const results=await Promise.allSettled(kinds.map(kind=>renderStoryboard({folder:path.join(base,kind)})));
 const failed=results.filter(x=>x.status==='rejected');if(failed.length)throw new AggregateError(failed.map(x=>x.reason),'Instruction rendering failed');
 fs.writeFileSync(path.join(base,'completed-videos.json'),JSON.stringify(results.map((x,i)=>({kind:kinds[i],video:x.value.video,duration_s:x.value.duration_s,chapters:x.value.chapters.length})),null,2));
 console.log('All four rebuilt instructional videos are ready.');
})().catch(e=>{console.error(e);process.exitCode=1;});
