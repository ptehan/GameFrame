const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..');
const excluded=new Set(['node_modules','dist','.git','.venv','.venv-ev','__pycache__','.pytest_cache']);
const files=[];
function walk(directory){
 for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  if(excluded.has(entry.name)||entry.isSymbolicLink()||/\.(db|sqlite)-(wal|shm)$/.test(entry.name))continue;
  const full=path.join(directory,entry.name);
  if(entry.isDirectory())walk(full);else if(entry.isFile())files.push({source:full,path:path.relative(root,full),bytes:fs.statSync(full).size});
 }
}
function hash(file){return new Promise((resolve,reject)=>{const digest=crypto.createHash('sha256');
 const stream=fs.createReadStream(file);stream.on('error',reject);stream.on('data',data=>digest.update(data));stream.on('end',()=>resolve(digest.digest('hex')));});}
(async()=>{
 walk(root);const bytes=files.reduce((sum,file)=>sum+file.bytes,0);
 if(process.argv.includes('--dry-run')){const totals={};for(const file of files){const key=file.path.split(path.sep)[0];totals[key]=(totals[key]||0)+file.bytes;}
  console.log(JSON.stringify({files:files.length,bytes,excluded:[...excluded],totals},null,2));return;}
 const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');
 const destination=path.resolve(root,'..','backups','GameFrameJS-'+stamp);
 const backupRoot=path.resolve(root,'..','backups');
 if(!destination.startsWith(backupRoot+path.sep)||fs.existsSync(destination))throw new Error('Invalid or existing checkpoint destination.');
 fs.mkdirSync(destination,{recursive:true});
 const copied=[];
 for(const file of files){
  const target=path.join(destination,file.path);fs.mkdirSync(path.dirname(target),{recursive:true});
  const sqlite=/\.(db|sqlite)$/.test(file.path);
  if(sqlite){
   const db=new Database(file.source,{readonly:true});try{await db.backup(target);}finally{db.close();}
  }else{fs.copyFileSync(file.source,target);}
  const sha256=await hash(target);
  if(!sqlite&&sha256!==await hash(file.source))throw new Error('Source changed or copy verification failed: '+file.path);
  copied.push({path:file.path,bytes:fs.statSync(target).size,sha256});
 }
 const db=new Database(path.join(destination,'app.db'),{readonly:true});
 let integrity;try{integrity=db.pragma('integrity_check',{simple:true});}finally{db.close();}
 if(integrity!=='ok')throw new Error('Backup database integrity check failed: '+integrity);
 fs.writeFileSync(path.join(destination,'BACKUP-MANIFEST.json'),JSON.stringify({created:new Date().toISOString(),source:root,
  excluded:[...excluded],external_sources:'Original videos outside the project (such as Downloads) are not copied; library blobs and project files are included.',
  database_integrity:integrity,files:copied},null,2));
 console.log(JSON.stringify({destination,files:copied.length,bytes:copied.reduce((sum,file)=>sum+file.bytes,0),database_integrity:integrity},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
