(function(root) {
  function calculateManualPitch(preview, release, extension, contactDistance) {
    const {start, end} = preview.selection;
    const contact = preview.contact_frame;
    const fps = preview.timing_fps;
    const mound = preview.settings.pitching_feet;
    if (![release, extension, contactDistance, fps, mound, contact].every(Number.isFinite) || release < start || release > end || release >= contact || fps <= 0 || extension < 0 || extension > 15 || contactDistance < 0 || contactDistance > 15) throw new Error('Choose a valid release frame and distances.');
    const distance = mound - extension - contactDistance;
    if (distance <= 0) throw new Error('Flight distance must be positive.');
    const frames = contact - release;
    const average = 3600 * distance * fps / frames / 5280;
    return {release, contact, fps, mound, extension, contactDistance, distance, frames, seconds:frames/fps, average, mph:1.05*average};
  }
  function createPitchReleasePicker(doc, onConfirm) {
    const el = name => doc.getElementById('pv-' + name);
    const dialog = el('picker'), confirm = el('confirm-release'), error = el('picker-error');
    const timeline = el('timeline');
    let preview = null, selected = null, current = 0, pairStart = 0, images = new Map(), generation = 0;
    function render(value, picked, keepPair = false) {
      const {start,end} = preview.selection;
      if (!Number.isFinite(value) || value < start || value > end || !Number.isInteger(value * 2)) {
        confirm.disabled = true; error.textContent = 'Choose a whole frame or halfway between frames.'; return;
      }
      error.textContent = ''; current = value;
      if (timeline) { timeline.min = start; timeline.max = end; timeline.value = value; }
      if (picked) selected = value;
      if (!keepPair) pairStart = Math.min(Math.floor(value),Math.max(start,end-1));
      const lo = pairStart, hi = Math.min(end,lo+1);
      el('frame-before').src = images.get(lo);
      el('frame-after').src = images.get(hi);
      el('before-label').textContent = 'Frame ' + lo;
      el('after-label').textContent = 'Frame ' + hi;
      el('release-label').textContent = Number.isInteger(value) ? 'On frame ' + value : 'Halfway: ' + lo + ' / ' + hi + ' (' + value + ')';
      el('frame-prev').disabled = value <= start;
      el('frame-next').disabled = value >= end;
      for (const [name,frame] of [['select-before',lo],['select-half',lo+0.5],['select-after',hi]]) {
        const button = el(name);
        button.setAttribute('aria-pressed',String(selected === frame));
        button.setAttribute('aria-label',name === 'select-half' ? 'Real release is between frames ' + lo + ' and ' + hi : 'Select frame ' + frame);
        button.disabled = name === 'select-half' && lo === hi;
        button.onclick = () => render(frame,true,true);
      }
      confirm.disabled = selected === null;
    }
    el('frame-prev').onclick = () => render(Math.max(preview.selection.start,Math.ceil(current)-1),true);
    el('frame-next').onclick = () => render(Math.min(preview.selection.end,Math.floor(current)+1),true);
    if (timeline) timeline.oninput = () => render(Number(timeline.value), true);
    el('picker-close').onclick = () => dialog.close();
    confirm.onclick = () => {
      try {
        if (selected === null) throw new Error('Choose a release frame.');
        onConfirm(calculateManualPitch(preview,selected,Number(preview.settings.search_extension_feet),Number(preview.settings.search_contact_feet)));
        dialog.close();
      } catch(e) { error.textContent = e.message; }
    };
    return {
      reset() { generation++; preview = null; selected = null; images.clear(); dialog.close(); },
      async open(snapshot, savedRelease = null) {
        if (!snapshot) return;
        const token = ++generation;
        preview = snapshot; selected = null; images = new Map(); confirm.disabled = true; error.textContent = '';
        try {
          if (!snapshot.review_frames?.length) throw new Error('No release frames available.');
          const decoded = await Promise.all(snapshot.review_frames.map(async item => { const img = new Image(); img.src = item.image; await img.decode(); return img; }));
          if (token !== generation) return;
          dialog.style.setProperty('--frame-aspect',String(decoded[0].naturalWidth / decoded[0].naturalHeight || 1));
          const frames = snapshot.review_frames.filter(item => item.frame >= snapshot.selection.start && item.frame <= snapshot.selection.end);
          for (const {frame,image} of frames) images.set(frame,image);
          el('picker-meta').textContent = Math.round(snapshot.timing_fps) + ' FPS | Contact ' + snapshot.contact_frame + ' | Mound ' + snapshot.settings.pitching_feet + ' ft';
          const restore = Number.isFinite(savedRelease) && savedRelease >= snapshot.selection.start && savedRelease <= snapshot.selection.end;
          render(restore ? savedRelease : snapshot.selection.start,restore);
          dialog.showModal(); el('select-before').focus();
        } catch(e) { el('status').textContent = 'Could not open release picker: ' + e.message; }
      }
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {calculateManualPitch,createPitchReleasePicker};
  else {
    root.createPitchReleasePicker = createPitchReleasePicker;
    root.calculateManualPitch = calculateManualPitch;
  }
})(typeof window === 'undefined' ? globalThis : window);
