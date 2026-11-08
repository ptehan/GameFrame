/* Saved measurements stay usable while their presentation video is prepared. */
(function(root){
  function watch({id,onStatus,onError,fetch:request=root.fetch.bind(root),interval=1000}){
    let stopped=false,timer=null;
    const tick=async()=>{
      try{
        const response=await request('/api/gameframe/ev-video-status?id='+encodeURIComponent(id),{cache:'no-store'});
        const status=await response.json();
        if(!response.ok){
          const error=Error(status.error||'Could not check the saved video.');error.status=response.status;
          if(response.status===404){if(!stopped)onError?.(error);stopped=true;return;}
          throw error;
        }
        if(stopped)return;
        onStatus(status);
        if(['ready','error','unavailable'].includes(status.status))return;
      }catch(error){if(!stopped)onError?.(error);}
      if(!stopped)timer=setTimeout(tick,interval);
    };
    void tick();
    return ()=>{stopped=true;clearTimeout(timer);};
  }
  async function retry(id){
    const response=await root.fetch('/api/gameframe/retry-ev-video',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    const status=await response.json();if(!response.ok)throw Error(status.error||'Could not restart video preparation.');return status;
  }
  root.GameFrameEvVideo={watch,retry};
})(window);
