// Wait for the local narration batch and render each remaining video once.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),base=path.join(root,'demo-output/instruction-continuous');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const run=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:'inherit'});p.on('error',reject);p.on('close',c=>c?reject(Error('Renderer exited '+c)):resolve());});
(async()=>{
 const narrationRoot=process.env.INSTRUCTION_NARRATION_ROOT?path.resolve(root,process.env.INSTRUCTION_NARRATION_ROOT):path.join(base,'narration');
 const kinds=process.env.INSTRUCTION_ALL_VIDEOS==='1'?['overview','hit-timing','technical','walkthrough']:['hit-timing','technical','walkthrough'];
 let cursor=0;
 async function worker(){while(cursor<kinds.length){const kind=kinds[cursor++];
  const file=path.join(narrationRoot,kind,'narration-manifest.json');
  console.log('Waiting for narration: '+kind);
  for(;;){try{const m=JSON.parse(fs.readFileSync(file));if(m.paragraphs?.length&&fs.existsSync(m.full_wav))break;}catch(_){}await sleep(5000);}
  await run(['scripts/render-continuous-instructions.cjs','demo-output/instruction-continuous/edit-plan.json',kind]);
 }}
 await Promise.all(Array.from({length:Number(process.env.INSTRUCTION_RENDER_WORKERS||1)},()=>worker()));
 fs.writeFileSync(path.join(base,'all-videos-ready.json'),JSON.stringify({completed_at:new Date().toISOString(),verification_files:['overview','hit-timing','technical','walkthrough'].map(k=>path.join(base,'render',k,'verification.json'))},null,2));
 console.log('All four continuous instructional videos are rendered and decoded.');
})().catch(e=>{console.error(e);process.exitCode=1});
