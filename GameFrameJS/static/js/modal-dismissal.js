/* Outside clicks and Escape never discard a modal or its unfinished work. */
(() => {
  const version='20261102-2';
  if(window.GameFrameModalDismissalVersion===version)return;
  window.GameFrameModalDismissal=true;
  window.GameFrameModalDismissalVersion=version;
  const selector='dialog,[role="dialog"],[aria-modal="true"],.modal,.manage-modal,.pose-modal,.frame-modal,.collage-modal,.entity-modal,.pitch-entity-modal,#entity_modal';
  const contentSelector='.modal-content,.modal-card,.menu-flow-card,.manage-modal-card,.pose-modal-card,.frame-modal-card,.collage-modal-card,.entity-modal-card,.pitch-entity-card';
  const backdropSelector='.modal-backdrop,.dialog-backdrop,[data-modal-backdrop],[data-dialog-backdrop]';
  const order=new WeakMap(),shown=new WeakMap(),watched=new WeakSet();let sequence=0;
  const stop=event=>{if(event.cancelable)event.preventDefault();event.stopImmediatePropagation();};
  const visible=modal=>modal.isConnected&&!modal.hidden&&(!modal.matches('dialog')||modal.open)&&modal.getClientRects().length>0&&getComputedStyle(modal).visibility!=='hidden'&&getComputedStyle(modal).display!=='none';
  function refresh(modal){
    const now=visible(modal);
    if(now&&!shown.get(modal))order.set(modal,++sequence);
    shown.set(modal,now);
    if(modal instanceof HTMLDialogElement&&modal.getAttribute('closedby')!=='none')modal.setAttribute('closedby','none');
  }
  const modalObserver=new MutationObserver(records=>records.forEach(record=>refresh(record.target)));
  function scan(){
    document.querySelectorAll(selector).forEach(modal=>{
      if(!watched.has(modal)){
        watched.add(modal);
        modalObserver.observe(modal,{attributes:true,attributeFilter:['open','hidden','style','class','aria-hidden','closedby']});
      }
      refresh(modal);
    });
  }
  function activeModal(){
    const modals=[...document.querySelectorAll(selector)].filter(visible);
    return modals.sort((a,b)=>{
      if(a.contains(b))return -1;if(b.contains(a))return 1;
      let aNative=false,bNative=false;
      try{aNative=a.matches(':modal');bNative=b.matches(':modal');}catch(_){}
      if(aNative!==bNative)return aNative?1:-1;
      if(aNative&&bNative)return (order.get(a)||0)-(order.get(b)||0);
      const difference=(parseInt(getComputedStyle(a).zIndex)||0)-(parseInt(getComputedStyle(b).zIndex)||0);
      return difference||(order.get(a)||0)-(order.get(b)||0);
    }).at(-1);
  }
  function protect(event){
    const modal=activeModal();if(!modal)return;
    const path=event.composedPath?.().filter(node=>node instanceof Element)||[event.target];
    const target=path[0];
    if(!(target instanceof Element))return;
    // Guided buttons can forward an action to a hidden file input or original
    // form button outside the dialog. Preserve those explicit scripted actions.
    if(!event.isTrusted&&target.closest('button,input,select,textarea,label,a,[role="button"]'))return;
    if(target===modal||!path.some(node=>node!==modal&&modal.contains(node))){stop(event);return;}
    if(target.closest('button,input,select,textarea,label,a,[role="button"]'))return;
    const content=[...modal.querySelectorAll(contentSelector)].find(node=>node.closest(selector)===modal)
      ||(modal.id==='entity_modal'?modal.firstElementChild:null);
    if(content&&!path.some(node=>node===content||content.contains(node))){stop(event);return;}
    if(!content&&target.closest(backdropSelector))stop(event);
  }
  for(const type of ['pointerdown','pointerup','mousedown','mouseup','click','dblclick','touchstart','touchend']){
    window.addEventListener(type,protect,{capture:true,passive:false});
  }
  window.addEventListener('cancel',event=>{if(event.target instanceof HTMLDialogElement)stop(event);},true);
  window.addEventListener('keydown',event=>{if(event.key==='Escape'&&activeModal())stop(event);},true);
  window.addEventListener('beforetoggle',event=>{
    if(event.target instanceof HTMLDialogElement&&event.newState==='open'){
      order.set(event.target,++sequence);shown.set(event.target,true);
      if(event.target.getAttribute('closedby')!=='none')event.target.setAttribute('closedby','none');
    }
  },true);
  new MutationObserver(records=>{
    if(records.some(record=>[...record.addedNodes].some(node=>node instanceof Element&&(node.matches(selector)||node.querySelector(selector)))))scan();
  }).observe(document.documentElement,{subtree:true,childList:true});
  scan();
})();
