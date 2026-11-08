/* Keep background export notices alive across workflow and page changes. */
(() => {
  if (window.GameFrameEvVideoNotifications) return;
  const key='gameframe-pending-ev-videos', jobs=new Map(), watching=new Map();
  const seen=new Map();
  let notice,timer=null;
  function persist(){try{sessionStorage.setItem(key,JSON.stringify([...jobs]));}catch(_){}}
  function hide(){
    clearTimeout(timer);
    if(notice?.hidePopover)notice.hidePopover();
    else if(notice)notice.hidden=true;
  }
  function popup(id,status){
    const phase=['ready','error'].includes(status)?status:'preparing';
    if(seen.get(id)===phase)return;
    seen.set(id,phase);
    try{sessionStorage.setItem(key+'-seen',JSON.stringify([...seen]));}catch(_){}
    if(!notice){
      notice=document.createElement('div');notice.setAttribute('popover','manual');notice.setAttribute('role','status');notice.setAttribute('aria-live','polite');
      notice.id='ev-video-background-notice';
      notice.style.cssText='position:fixed;inset:auto 16px 16px auto;margin:0;max-width:min(480px,calc(100vw - 32px));padding:12px 16px;border:1px solid #aac7c0;border-radius:8px;background:#eff8f5;color:#173b34;font:14px/1.4 Arial,sans-serif;box-shadow:0 3px 16px #0002';
      document.body.append(notice);
    }
    notice.replaceChildren();
      const row=document.createElement('div');
      row.append(status==='ready'?'Your EV video is ready. ':status==='error'?'Hit saved. EV video preparation needs a retry. ':'Hit saved. The EV video is being prepared. You can continue with swing timing.');
      if(status==='ready'||status==='error'){
        const link=document.createElement('a');link.href='/play/ev?id='+encodeURIComponent(id);link.target='_blank';link.rel='noopener';link.textContent=status==='ready'?'View video':'View saved hit';link.style.cssText='color:#075f52;font-weight:bold';
        link.onclick=()=>{jobs.delete(id);persist();hide();};row.append(link);
      }
      notice.append(row);
    notice.hidden=false;
    if(notice.showPopover&&!notice.matches(':popover-open'))notice.showPopover();
    const dismiss=()=>{hide();if(phase!=='preparing'){jobs.delete(id);persist();}};
    const schedule=()=>{clearTimeout(timer);timer=setTimeout(dismiss,phase==='preparing'?4000:12000);};
    notice.onmouseenter=()=>clearTimeout(timer);notice.onfocusin=()=>clearTimeout(timer);
    notice.onmouseleave=schedule;notice.onfocusout=schedule;schedule();
  }
  function watch(id){
    if(watching.has(id)||['ready','error'].includes(jobs.get(id)))return;
    watching.set(id,window.GameFrameEvVideo.watch({id,onStatus:status=>{
      if(status.status==='unavailable'){jobs.delete(id);persist();return;}
      jobs.set(id,status.status);persist();popup(id,status.status);
    },onError:error=>{if(error.status===404){jobs.delete(id);persist();hide();}}}));
  }
  function track(id,status='queued'){
    id=Number(id);if(!Number.isSafeInteger(id)||id<=0)return;
    if(parent!==window){parent.postMessage({type:'gameframe:ev-video-preparing',id,status},location.origin);return;}
    jobs.set(id,['ready','error'].includes(status)?status:'queued');persist();popup(id,status);watch(id);
  }
  window.GameFrameEvVideoNotifications={track};
  if(parent!==window)return;
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.data?.type!=='gameframe:ev-video-preparing')return;
    if(![...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===event.source))return;
    track(event.data.id,event.data.status);
  });
  try{for(const [id,status] of JSON.parse(sessionStorage.getItem(key)||'[]'))jobs.set(Number(id),status);}catch(_){}
  try{for(const [id,phase] of JSON.parse(sessionStorage.getItem(key+'-seen')||'[]'))seen.set(Number(id),phase);}catch(_){}
  for(const [id,status] of jobs){popup(id,status);watch(id);}
})();
