/* Fullscreen the document, rather than the video, to retain tagging controls. */
(() => {
  'use strict';
  if (window.GameFrameTaggingFullscreen) return;
  let active = null, ownsFullscreen = false;
  const roots = '#setup-modal,#actual-field-map-modal,#frame_modal,#pv-picker,.viewer-panel';
  function refresh() {
    document.querySelectorAll('[data-tagging-fullscreen]').forEach(button => {
      const selected = active && active.contains(button);
      button.textContent = selected ? 'Exit full screen' : 'Full screen';
      button.setAttribute('aria-pressed', String(Boolean(selected)));
    });
    window.dispatchEvent(new Event('resize'));
  }
  function clear() {
    active?.classList.remove('tagging-fullscreen-target');
    active = null;
    document.documentElement.classList.remove('tagging-fullscreen');
    refresh();
  }
  async function exit() {
    const shouldExit = ownsFullscreen && document.fullscreenElement;
    ownsFullscreen = false;
    clear();
    if (shouldExit) await document.exitFullscreen().catch(() => {});
  }
  async function toggle(target) {
    if (active === target) return exit();
    active?.classList.remove('tagging-fullscreen-target');
    active = target;
    active.classList.add('tagging-fullscreen-target');
    document.documentElement.classList.add('tagging-fullscreen');
    refresh();
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen();
        ownsFullscreen = true;
        // The editor can close while the browser is entering fullscreen.
        if (!active) await exit();
      } catch (_) { /* Keep the viewport-sized editor when fullscreen is unavailable. */ }
    }
  }
  function attach() {
    if (document.documentElement.classList.contains("gf-guided")) return;
    document.querySelectorAll(roots).forEach(root => {
      if (root.dataset.taggingFullscreenReady) return;
      const host = root.querySelector('.setup-heading,.frame-modal-header,header,.transport');
      if (!host) return;
      root.dataset.taggingFullscreenReady = 'true';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tagging-fullscreen-button';
      button.dataset.taggingFullscreen = '';
      button.textContent = 'Full screen';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => toggle(root.closest('#setup-modal') || root));
      host.append(button);
      root.addEventListener('close', () => { if (active === root) exit(); });
    });
  }
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && ownsFullscreen) { ownsFullscreen = false; clear(); }
    else refresh();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && active && !document.fullscreenElement) {
      event.preventDefault(); event.stopImmediatePropagation(); exit();
    }
  }, true);
  const style = document.createElement('style');
  style.textContent = `
    .tagging-fullscreen-button { display:inline-flex!important; align-items:center; justify-content:center; flex:0 0 auto; min-height:36px; padding:7px 12px; border:1px solid #b8c9c5; border-radius:5px; background:#fff; color:#172822; cursor:pointer; margin-left:auto; white-space:nowrap; }
    .setup-modal .setup-heading:has(> .tagging-fullscreen-button) { display:flex; align-items:center; flex-wrap:wrap; gap:8px 16px; padding:10px 14px; }
    .workflow-viewer-slot .transport > .tagging-fullscreen-button { display:none!important; }
    html.tagging-fullscreen { overflow:hidden; }
    html.tagging-fullscreen .tagging-fullscreen-target { box-sizing:border-box!important; width:100vw!important; max-width:none!important; height:100dvh!important; max-height:100dvh!important; margin:0!important; padding:0!important; inset:0!important; border:0!important; border-radius:0!important; background:#fff; }
    html.tagging-fullscreen .tagging-fullscreen-target > .setup-card,
    html.tagging-fullscreen #frame_modal.tagging-fullscreen-target > .frame-modal-card { box-sizing:border-box; width:100%!important; max-width:none!important; height:100dvh!important; max-height:100dvh!important; border-radius:0; }
    html.tagging-fullscreen .viewer-panel.tagging-fullscreen-target { position:fixed; z-index:11000; display:grid!important; grid-template-rows:auto minmax(0,1fr) auto; }
    html.tagging-fullscreen .viewer-panel.tagging-fullscreen-target > .viewer { width:100%; height:100%; max-height:none; min-height:0; }
    html.tagging-fullscreen #frame_modal .frame-modal-controls { max-height:45dvh; overflow-y:auto; }
    #frame_modal .frame-modal-slider { display:block!important; width:100%; }
    #frame_modal .trim-preview-controls { display:flex!important; gap:8px; }
    #pv-picker .pv-release-timeline { display:block; box-sizing:border-box; width:100%; margin:8px 0; min-height:28px; }
  `;
  document.head.append(style);
  attach();
  new MutationObserver(records => {
    if (records.some(record => record.addedNodes.length)) attach();
    if (active && (!active.isConnected || active.hidden ||
        (active.tagName === 'DIALOG' && !active.open) ||
        (active.id === 'frame_modal' && getComputedStyle(active).display === 'none'))) exit();
  }).observe(document.body, {childList:true, subtree:true, attributes:true, attributeFilter:['style','class','hidden','open']});
  window.GameFrameTaggingFullscreen = {toggle, exit};
})();
