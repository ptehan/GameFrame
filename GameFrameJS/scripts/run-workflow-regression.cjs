const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const directory=path.join(root,'demo-output','regression-'+Date.now());
fs.mkdirSync(directory,{recursive:true});
const tests=['matchup-pending-handoff.cjs','matchup-wizard-browser.cjs','pitch-guided-browser.cjs',
 'swing-guided-browser.cjs','ev-guided-browser.cjs','ev-landing-review-browser.cjs',
 'workflow-help-browser.cjs','remember-upload-people-browser.cjs','ui-cleanup-browser.cjs',
 'measurement-dashboard-browser.cjs','timing-dashboard-browser.cjs'];
const results=[];
for(const name of tests){
 const start=Date.now();console.log('RUN '+name);
 const result=spawnSync(process.execPath,[path.join(root,'test',name)],{cwd:root,env:process.env,
  encoding:'utf8',timeout:300000,windowsHide:true,maxBuffer:8*1024*1024});
 fs.writeFileSync(path.join(directory,name+'.log'),(result.stdout||'')+'\n'+(result.stderr||''));
 const entry={test:name,exitCode:result.status,seconds:(Date.now()-start)/1000,
  passed:result.status===0,error:result.error?.message||null};
 results.push(entry);console.log(JSON.stringify(entry));
 fs.writeFileSync(path.join(directory,'results.json'),JSON.stringify(results,null,2));
}
console.log('Evidence: '+directory);
if(results.some(r=>!r.passed))process.exitCode=1;
