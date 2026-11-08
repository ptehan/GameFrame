const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const directory=path.join(root,'demo-output','core-regression-'+Date.now());fs.mkdirSync(directory,{recursive:true});
const nodeTests=fs.readdirSync(path.join(root,'test')).filter(name=>/\.test\.(cjs|js)$/.test(name)).map(name=>path.join('test',name));
const suites=[{name:'node',command:process.execPath,args:['--test','--test-concurrency=1',...nodeTests]},
 {name:'python',command:path.join(root,'.venv-ev','Scripts','python.exe'),args:['-m','unittest','discover','-s','test','-p','test_*.py']}];
const results=[];
const requested=process.argv[2];
if(requested&&!suites.some(s=>s.name===requested))throw new Error('Choose node or python, or omit for both.');
for(const suite of suites.filter(s=>!requested||s.name===requested)){
 const start=Date.now();console.log('RUN '+suite.name+' '+suite.args.join(' '));
 const log=fs.openSync(path.join(directory,suite.name+'.log'),'w');
 const result=spawnSync(suite.command,suite.args,{cwd:root,env:{...process.env,OPENBLAS_NUM_THREADS:'1',OMP_NUM_THREADS:'1'},
  stdio:['ignore',log,log],timeout:900000,windowsHide:true});fs.closeSync(log);
 results.push({suite:suite.name,passed:result.status===0,exitCode:result.status,seconds:(Date.now()-start)/1000,error:result.error?.message||null});
 console.log(JSON.stringify(results.at(-1)));fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
}
console.log('Evidence: '+directory);if(results.some(r=>!r.passed))process.exitCode=1;
