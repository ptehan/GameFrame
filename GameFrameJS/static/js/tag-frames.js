async function decodeExactTagFrames(tempId, onProgress) {
    const response = await fetch(`/api/raw/tag-frames?id=${encodeURIComponent(tempId)}`);
    if (!response.ok) throw new Error(await response.text() || "Could not decode clip frames.");
    const expected = Number(response.headers.get("X-Frame-Count") || 0);
    const reader = response.body.getReader();
    const frames = [];
    let pending = new Uint8Array(0);
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bytes = new Uint8Array(pending.length + value.length);
        bytes.set(pending);
        bytes.set(value, pending.length);
        let offset = 0;
        while (offset < bytes.length - 1) {
            let start = -1;
            for (let i = offset; i < bytes.length - 1; i += 1) {
                if (bytes[i] === 0xff && bytes[i + 1] === 0xd8) { start = i; break; }
            }
            if (start < 0) { offset = Math.max(0, bytes.length - 1); break; }
            let end = -1;
            for (let i = start + 2; i < bytes.length - 1; i += 1) {
                if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { end = i + 2; break; }
            }
            if (end < 0) { offset = start; break; }
            frames.push(await createImageBitmap(new Blob([bytes.slice(start, end)], { type: "image/jpeg" })));
            onProgress?.(frames.length, expected || frames.length);
            offset = end;
        }
        pending = bytes.slice(offset);
    }
    if (!frames.length) throw new Error("No video frames were decoded.");
    if (expected && frames.length !== expected) throw new Error(`Decoded ${frames.length} of ${expected} frames. Please retry.`);
    return frames;
}

// Share the most recent exact-frame set with the containing workspace. Never
// substitute sampled flight frames or frames from another temporary source.
(() => {
    let owner=window;
    try { if(parent!==window && parent.location.origin===location.origin) owner=parent; } catch (_) {}
    if(!owner.GameFrameTagFrameCache) owner.GameFrameTagFrameCache=new Map();
    const cache=owner.GameFrameTagFrameCache;
    window.GameFrameTagFrames={
        metadata(id){return cache.get(String(id))?.metadata || null;},
        load(id,onProgress,metadata){
            id=String(id);
            const existing=cache.get(id);
            if(existing){
                return existing.promise.then(frames=>{onProgress?.(frames.length,frames.length);return frames;});
            }
            cache.clear();
            const entry={metadata,promise:null};
            entry.promise=decodeExactTagFrames(id,onProgress).then(frames=>{
                // Bound retained memory; never close bitmaps a live tagger uses.
                if(frames.reduce((n,f)=>n+f.width*f.height*4,0)>256*1024*1024 && cache.get(id)===entry)cache.delete(id);
                return frames;
            }).catch(error=>{if(cache.get(id)===entry)cache.delete(id);throw error;});
            cache.set(id,entry);
            setTimeout(()=>{if(cache.get(id)===entry)cache.delete(id);},120000);
            return entry.promise;
        }
    };
})();
function loadExactTagFrames(tempId,onProgress,metadata){
    return window.GameFrameTagFrames.load(tempId,onProgress,metadata);
}
