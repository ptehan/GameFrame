const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),{spawnSync}=require('child_process');
test('a silent timing-only swing opens manual contact tagging with exact frames',async()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'gf-silent-swing-'));process.env.DB_PATH=path.join(folder,'app.db');const file=path.join(folder,'dry-swing.mp4');
 const made=spawnSync(require('ffmpeg-static'),['-y','-v','error','-f','lavfi','-i','color=c=blue:s=96x96:r=30:d=3','-an','-c:v','libx264','-threads','1',file],{windowsHide:true});assert.equal(made.status,0,made.stderr?.toString());
 const {startServer,closeDatabase}=require('../server'),server=startServer(0,'127.0.0.1');await new Promise(r=>server.listening?r():server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{const form=new FormData();form.set('file',new Blob([fs.readFileSync(file)]),'dry-swing.mp4');form.set('team_id','1');form.set('hitter_id','1');form.set('swing_type','tee');
 const response=await fetch(base+'/multi-swing/prepare-tag',{method:'POST',body:form});assert.equal(response.status,200,await response.clone().text());const data=await response.json();assert.equal(data.preset_contact_frame,null);assert.equal(data.frame_count,90);assert.equal(data.fps,30);assert.equal(data.source_contact_seconds,null);
 const raw=await fetch(base+'/api/raw/swing-meta?id='+data.temp_id);assert.equal((await raw.json()).frame_count,90);
 const page=await(await fetch(base+'/upload/swing/trim?temp_id='+data.temp_id+'&fps=30&team_id=1&hitter_id=1')).text();assert.match(page,/HAS_PRESET_CONTACT\s*=\s*false/);
 }finally{await new Promise(r=>server.close(r));closeDatabase();}
});
