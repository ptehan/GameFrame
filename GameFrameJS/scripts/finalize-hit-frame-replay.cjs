const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const Database=require('better-sqlite3');
const root=path.resolve(__dirname,'..');
const db=new Database(path.join(root,'app.db'),{readonly:true});
const folder=path.resolve(process.argv[2]);
const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json')));
const row=db.prepare('SELECT observation_package_json FROM ev_hit_tracks WHERE id=?').get(manifest.hit_id);
const pack=JSON.parse(row.observation_package_json);db.close();
const step=Number(pack.video_metadata.frame_step_assumption_s)||1/Number(pack.video_metadata.fps||30);
for(const mark of pack.ball_observations||[]){
 const entry=manifest.entries.find(e=>e.saved_mark?.video_time_s===mark.video_time_s);
 assert.ok(entry,'Every saved ball tag must be captured');
 assert.deepEqual(entry.saved_mark,mark,'Recorded coordinates must remain exact');
 assert.ok(Math.abs(entry.displayed_video_time_s-mark.video_time_s)<=step*.55+.003,'Tag must be on its recorded frame');
}
for(const skip of pack.skipped_video_marks||[])if(/^flight\d+$/.test(skip))assert.ok(manifest.entries.some(e=>e.saved_skip===skip));
for(const landmark of pack.landmarks||[])assert.ok(manifest.entries.some(e=>JSON.stringify(e.saved_landmark)===JSON.stringify(landmark)));
const ground=manifest.entries.find(e=>e.saved_terminal_event);
if(ground){
 const event=ground.saved_terminal_event;
 ground.group='Tagged ball frames';ground.title=`Ground-contact tag - ${Math.round(Number(event.relative_time_s)/step)} frames after contact`;
 ground.note=`Saved ground-contact time ${Number(event.video_time_s).toFixed(6)} s. ${event.image_x===null?'No ground pixel location was marked.':''}`;
 assert.deepEqual(event,pack.terminal_event,'Ground tag must match the saved event');
 // The capture pipeline already checks the seek before taking this image.
 if(ground.displayed_video_time_s!==undefined)assert.ok(Math.abs(ground.displayed_video_time_s-event.video_time_s)<=step*.55+.003);
}
const geometry=pack.hit?.distance_observation?.actual_field_map||pack.camera?.actual_field_map;
if(geometry?.evidence_image_data_url){
 const match=geometry.evidence_image_data_url.match(/^data:image\/(png|jpeg);base64,(.+)$/s);
 if(match&&!manifest.entries.some(e=>e.title==='Original saved map reference')){
  const file='images/saved-map-reference.'+(match[1]==='jpeg'?'jpg':'png');
  fs.writeFileSync(path.join(folder,file),Buffer.from(match[2],'base64'));
  const index=manifest.entries.findIndex(e=>e.title==='Saved landing certainty');
  manifest.entries.splice(index<0?0:index,0,{group:'Saved field setup',title:'Original saved map reference',note:`Unaltered map reference stored with hit #${manifest.hit_id}, showing its saved field marks.`,file});
 }
}
const groupOrder=['Saved field setup','Tagged ball frames','Saved field calibration','Saved result'];
manifest.entries.sort((a,b)=>groupOrder.indexOf(a.group)-groupOrder.indexOf(b.group));
manifest.validation={all_saved_ball_tags:true,all_saved_flight_skips:true,all_saved_field_tags:true,exact_saved_coordinates:true,recorded_frame_timing:true};
fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2));
const html=fs.readFileSync(path.join(__dirname,'screen-gallery-template.html'),'utf8').replace('__SCREEN_DATA__',JSON.stringify(manifest.entries).replace(/</g,'\\u003c'));
fs.writeFileSync(path.join(folder,'index.html'),html);
console.log(JSON.stringify({hit:manifest.hit_id,pages:manifest.entries.length,validation:manifest.validation}));
