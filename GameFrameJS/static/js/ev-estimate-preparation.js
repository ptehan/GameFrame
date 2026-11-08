(function(root){
  function createEstimatePreparation(fetcher){
    let record=null;
    return {
      prepare(evidenceKey,requestKey,payload){
        if(record?.evidenceKey===evidenceKey && (record.requestKey===requestKey || !record.finished))return record.promise;
        record?.controller.abort();
        const controller=new AbortController();
        const next={evidenceKey,requestKey,controller,finished:false,promise:null};
        record=next;
        next.promise=(async()=>{
          try{
            const response=await fetcher('/api/predict',{method:'POST',headers:{'Content-Type':'application/json'},
              signal:controller.signal,body:JSON.stringify(payload)});
            if(!response.ok)return null;
            const value=await response.json();
            return controller.signal.aborted?null:value;
          }catch{return null;}
          finally{next.finished=true;}
        })();
        return next.promise;
      },
      get(requestKey){return record?.requestKey===requestKey?record.promise:null;},
      cancel(){record?.controller.abort();record=null;}
    };
  }
  if(typeof module==='object'&&module.exports)module.exports={createEstimatePreparation};
  else root.GameFrameEstimatePreparation={createEstimatePreparation};
})(typeof window==='undefined'?globalThis:window);
