(function(root){
 'use strict';
 function prepare(payload,videoWidth,videoHeight){
  if(payload?.version!==1||!payload.session||!payload.contact||!Array.isArray(payload.points)||!Array.isArray(payload.session.times))throw Error('Invalid ball-marking handoff.');
  const s=payload.session,c=payload.contact,time=s.times[c.frame],sx=videoWidth/s.width,sy=videoHeight/s.height;
  if(!Number.isFinite(time)||!(sx>0&&sy>0)||!Number.isFinite(c.x)||!Number.isFinite(c.y))throw Error('Invalid contact frame.');
  const observation=(p,source,role)=>{
   const t=s.times[p.frame];
   if(!Number.isFinite(t)||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>=s.width||p.y>=s.height)throw Error('Invalid ball point.');
   return {video_time_s:t,relative_time_s:t-time,image_x:p.x*sx,image_y:p.y*sy,timing_uncertainty_s:1/(2*s.fps),uncertainty_px:source==='HUMAN'?3:6,source,role,confidence:source==='HUMAN'?'HIGH':'MEDIUM',human_reviewed:source!=='HUMAN'};
  };
  const flight=payload.accepted?payload.points.filter(p=>p.frame>c.frame).map(p=>observation(p,p.status==='manual'?'HUMAN':'COMPUTER_VISION','FLIGHT_POINT')):[];
  if(payload.accepted&&!flight.length)throw Error('No detected flight points to continue with.');
  return {contactTime:time,accepted:!!payload.accepted,observations:[observation(c,'HUMAN','CONTACT_POINT'),...flight].sort((a,b)=>a.relative_time_s-b.relative_time_s)};
 }
 const api={prepare};if(typeof module==='object'&&module.exports)module.exports=api;else root.GameFrameBallAssist=api;
})(typeof globalThis!=='undefined'?globalThis:this);
