// Keep immutable detector code loaded; each request scans its own raw frames anew.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
function createModelWorkers({python,root,stop}){
 const workers=new Map();
 function verify(directory){const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));for(const [file,hash] of Object.entries(manifest.files))if(crypto.createHash('sha256').update(fs.readFileSync(path.join(directory,file))).digest('hex')!==hash)throw Error('Frozen detector source changed.');return manifest;}
 function warm(directory){
  const manifest=verify(directory);
  // Editing detector code must not leave every previous native runtime resident.
  // Keep an active scan alive; retire only idle versions that cannot serve this snapshot.
  for(const [fingerprint,worker] of workers){if(fingerprint!==manifest.fingerprint&&!worker.pending.size){workers.delete(fingerprint);stop(worker.child);}}
  if(workers.has(manifest.fingerprint))return workers.get(manifest.fingerprint);
  const child=spawn(python,['-u',path.join(directory,'tracker.py'),'--worker'],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}}),pending=new Map();
  const worker={child,pending,directory,manifest};workers.set(manifest.fingerprint,worker);let stderr='';
  const fail=error=>{if(workers.get(manifest.fingerprint)===worker)workers.delete(manifest.fingerprint);for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
  require('node:readline').createInterface({input:child.stdout}).on('line',line=>{let value;try{value=JSON.parse(line);}catch{return;}const entry=pending.get(value.id);if(!entry)return;if(value.progress){entry.job.progress=value.progress;return;}pending.delete(value.id);clearTimeout(entry.timer);value.error?entry.reject(Error(value.error)):entry.resolve();});
  child.stderr.on('data',data=>{stderr=(stderr+data).slice(-6000);});child.on('error',fail);child.stdin.on('error',fail);child.on('close',()=>fail(Error(stderr||'The detector stopped.')));
  return worker;
 }
 function run(directory,input,output,job){return new Promise((resolve,reject)=>{
  const worker=warm(directory);verify(worker.directory);const id=crypto.randomUUID();
  const cancel=()=>{stop(worker.child);if(workers.get(worker.manifest.fingerprint)===worker)workers.delete(worker.manifest.fingerprint);};
  const timer=setTimeout(()=>{worker.pending.delete(id);cancel();reject(Error('Detection timed out.'));},900000);
  worker.pending.set(id,{resolve,reject,timer,job});job.cancel=()=>{const entry=worker.pending.get(id);if(entry){worker.pending.delete(id);clearTimeout(timer);cancel();reject(Error('Detection cancelled.'));}};
  worker.child.stdin.write(JSON.stringify({id,input,output,mode:'contact'})+'\n');
 });}
 return {warm,run,stop:()=>{for(const worker of workers.values())stop(worker.child);workers.clear();}};
}
module.exports={createModelWorkers};
