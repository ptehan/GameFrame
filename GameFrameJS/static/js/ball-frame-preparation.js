/* Reuse raw sampled frames, never detector results. One video/contact at a time. */
(function(root){
  function coversContact(session,time,fps){
    if(!Array.isArray(session?.times)||!session.launchFrameCount)return false;
    const index=session.times.findIndex(t=>Math.abs(t-time)<=.55/fps);
    const required=Math.ceil(fps*.2);
    return index>=0&&index+required<session.launchFrameCount&&session.times.length>index+required
      &&session.times.slice(index,index+required+1).every((t,i,a)=>!i||t-a[i-1]<=1.6/fps);
  }
  const sameRate=(a,b)=>Math.abs(a-b)<=Math.max(.05,Math.max(a,b)*.005);
  function createFramePreparation(){
    let entry=null;
    return async function prepare(identity,time,fps,load,signal){
      if(entry&&entry.identity===identity&&entry.time===time&&sameRate(entry.fps,fps)&&(entry.ready||!entry.signal?.aborted))return entry.promise;
      let prior=null;
      if(entry&&entry.identity===identity&&sameRate(entry.fps,fps)&&(entry.ready||!entry.signal?.aborted)){
        try{prior=await entry.promise;if(coversContact(prior,time,fps))return prior;}catch(_){}
      }
      const current={identity,time,fps,signal,ready:false,promise:null};
      current.promise=Promise.resolve().then(()=>load(prior)).then(result=>{current.ready=true;return result;}).catch(error=>{if(entry===current)entry=null;throw error;});
      entry=current;
      return current.promise;
    };
  }
  if(typeof module==='object'&&module.exports)module.exports={createFramePreparation,coversContact};
  else root.GameFrameRawFrames={createFramePreparation,coversContact};
})(typeof window==='undefined'?globalThis:window);
