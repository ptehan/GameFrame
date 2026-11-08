const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');

test('reuse the current detector, retire stale idle runtimes, preserve an active scan',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'gf-model-cache-')),children=[],stopped=[];
 const spawn=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new EventEmitter();child.stdin.write=line=>{child.request=JSON.parse(line)};children.push(child);return child};
 const sandbox={require:name=>name==='node:child_process'?{spawn}:require(name),module:{exports:{}},process:{env:{}},setTimeout,clearTimeout};vm.runInNewContext(fs.readFileSync('experiments/ball-assist/model-worker.cjs','utf8'),sandbox);
 const workers=sandbox.module.exports.createModelWorkers({python:'fixture',root:directory,stop:child=>stopped.push(child)});
 function snapshot(name){const folder=path.join(directory,name);fs.mkdirSync(folder);const file=Buffer.from(name);fs.writeFileSync(path.join(folder,'tracker.py'),file);fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({fingerprint:name,files:{'tracker.py':crypto.createHash('sha256').update(file).digest('hex')}}));return folder}
 try{
  const a=snapshot('a'),b=snapshot('b'),c=snapshot('c');workers.warm(a);workers.warm(a);assert.equal(children.length,1);
  const active=workers.run(a,'input','output',{});workers.warm(b);assert.equal(children.length,2);assert.equal(stopped.length,0,'An in-flight scan must survive a new code snapshot');
  children[0].stdout.write(JSON.stringify({id:children[0].request.id,ok:true})+'\n');await active;
  workers.warm(b);assert.deepEqual(stopped,[children[0]]);assert.equal(children.length,2);
  workers.warm(c);assert.deepEqual(stopped,[children[0],children[1]]);
 }finally{workers.stop();fs.rmSync(directory,{recursive:true,force:true});}
 assert.equal(stopped.length,3);
});
