(function(root){
 'use strict';
 function layout(width,height,points,canvasWidth,canvasHeight){
  const x=points.map(p=>p.reference_image_x),y=points.map(p=>p.reference_image_y);
  if(![width,height,canvasWidth,canvasHeight,...x,...y].every(Number.isFinite))throw Error('Missing contact-view coordinates.');
  const pad=Math.max(width,height)*.025,left=Math.min(0,...x)-pad,top=Math.min(0,...y)-pad;
  const right=Math.max(width,...x)+pad,bottom=Math.max(height,...y)+pad;
  const scale=Math.min(canvasWidth/(right-left),canvasHeight/(bottom-top));
  return {scale,dx:(canvasWidth-(right-left)*scale)/2-left*scale,dy:(canvasHeight-(bottom-top)*scale)/2-top*scale};
 }
 const api={layout};if(typeof module==='object'&&module.exports)module.exports=api;else root.GameFrameContactPicture=api;
})(typeof globalThis!=='undefined'?globalThis:this);
