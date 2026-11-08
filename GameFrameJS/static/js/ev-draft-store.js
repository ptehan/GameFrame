/* Local, resumable EV work. Video is stored once; mark updates are serialized. */
(() => {
  let database, timer, queued, latestFile, writes = Promise.resolve();
  function open() {
    if (!database) database = new Promise((resolve,reject) => {
      const request=indexedDB.open('gameframe-ev-draft',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('draft');
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    return database;
  }
  async function transaction(mode,action) {
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('draft',mode), store=tx.objectStore('draft');
      const request=action(store);
      tx.oncomplete=()=>resolve(request?.result);
      tx.onabort=tx.onerror=()=>reject(tx.error || new Error('Local draft storage unavailable'));
    });
  }
  function status(message,failed=false) {
    let el=document.getElementById('ev-draft-status');
    if(!el){el=document.createElement('p');el.id='ev-draft-status';el.setAttribute('role','status');document.body.append(el);}
    el.textContent=message; el.hidden=!failed;
  }
  async function save(value) {
    const file=value.file;
    if(file && latestFile!==file) {
      await transaction('readwrite',store=>store.put(file,'video'));
      latestFile=file;
    }
    await transaction('readwrite',store=>store.put({...value,file:undefined,savedAt:Date.now()},'marks'));
    status('Draft saved on this device');
  }
  function flush() {
    clearTimeout(timer);
    if(queued){const value=queued;queued=null;writes=writes.catch(()=>{}).then(()=>save(value));}
    return writes.catch(error=>{status('Could not save the local draft. Keep this editor open: '+error.message,true);throw error;});
  }
  window.GameFrameEvDrafts={
    schedule(value){queued=value;clearTimeout(timer);timer=setTimeout(()=>flush().catch(()=>{}),200);},
    flush,
    async read(){const marks=await transaction('readonly',store=>store.get('marks')); if(!marks)return null; const file=await transaction('readonly',store=>store.get('video'));return {...marks,file};},
    async clear(){clearTimeout(timer);queued=null;await writes.catch(()=>{});await transaction('readwrite',store=>store.clear());latestFile=null;},
  };
})();
