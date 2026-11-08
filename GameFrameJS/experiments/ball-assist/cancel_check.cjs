const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base='http://127.0.0.1:8017';
async function json(url,options){const response=await fetch(base+url,options),value=await response.json();if(!response.ok)throw Error(value.error||response.status);return value;}
(async()=>{const [session,waitJob]=process.argv.slice(2);if(!session)throw Error('Supply a loaded test session id.');
 if(waitJob){let state;do{state=await json('/api/jobs/'+waitJob);if(state.state==='running')await new Promise(r=>setTimeout(r,500));}while(state.state==='running');}
 const job=await json('/api/detect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({session,contact:{frame:10,x:360.8,y:324.19}})});
 assert.equal((await json('/api/jobs/'+job.id,{method:'DELETE'})).state,'cancelled');
 await new Promise(r=>setTimeout(r,1500));assert.equal((await json('/api/jobs/'+job.id)).state,'cancelled');
 fs.writeFileSync(path.resolve(__dirname,'../../demo-output/ball-assist-lab/cancel-check.json'),JSON.stringify({passed:true,job:job.id,state:'cancelled'}));console.log('Cancellation passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
