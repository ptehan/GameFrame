/* Only the active EV dialog is visible. Closing preserves the unfinished draft. */
(() => {
 if(window.GameFrameEvDialogs)return;
 const stack=[];let scheduled=false;
 async function close(dialog,button){
  if(dialog.id==='actual-field-map-modal'&&typeof actualMapStage!=='undefined'){
   if(actualMapStage==='review'){cancelLandingReview();return;}
   if(actualMapStage==='compare'){closeActualFieldMapModal();return;}
  }
  button.disabled=true;
  try{await window.GameFrameEvDrafts?.flush();}catch(_){}
  button.disabled=false;
  if(parent!==window&&document.referrer){parent.postMessage({type:'gameframe:close-ev'},new URL(document.referrer).origin);return;}
  dialog.close();document.body.classList.remove('setup-modal-open');
 }
 function sync(){
  scheduled=false;
  const dialogs=[...document.querySelectorAll('dialog')];
  for(let i=stack.length-1;i>=0;i--)if(!stack[i].open||!stack[i].isConnected)stack.splice(i,1);
  dialogs.filter(d=>d.open&&!stack.includes(d)).forEach(d=>stack.push(d));
  const active=stack.at(-1);
  for(const dialog of dialogs){
   const inactive=dialog.open&&dialog!==active;
   if(dialog.classList.contains('ev-dialog-inactive')!==inactive)dialog.classList.toggle('ev-dialog-inactive',inactive);
   if(!['setup-modal','actual-field-map-modal','ev-complete-modal','video-picker-modal'].includes(dialog.id))continue;
   const host=dialog.querySelector('.setup-heading')||(dialog.id==='video-picker-modal'?dialog:null);if(!host)continue;
   if(dialog.id==='video-picker-modal'){const cancel=dialog.querySelector('form[method="dialog"]');if(cancel&&!cancel.hidden)cancel.hidden=true;}
   if(!dialog.querySelector('.ev-dialog-close')){
    const button=document.createElement('button');button.type='button';button.className='ev-dialog-close';button.textContent='Close';
    button.addEventListener('click',()=>close(dialog,button));host.append(button);
   }
  }
  const redundant=document.getElementById('actual-map-back-diagram');if(redundant&&!redundant.hidden)redundant.hidden=true;
 }
 function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(sync);}}
 const observer=new MutationObserver(records=>{
  records.filter(r=>r.type==='attributes'&&r.attributeName==='open'&&r.target instanceof HTMLDialogElement&&r.target.open).forEach(r=>{const i=stack.indexOf(r.target);if(i>=0)stack.splice(i,1);stack.push(r.target);});schedule();
 });
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','class','hidden']});
 window.GameFrameEvDialogs={refresh:schedule};schedule();
})();
