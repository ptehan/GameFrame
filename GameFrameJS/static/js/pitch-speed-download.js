(() => {
  const pending = new Set();
  document.addEventListener('click', async event => {
    const link = event.target.closest('a[data-pitch-speed-export]');
    if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (pending.has(link.href)) return;
    const href = link.href;
    pending.add(href);
    link.setAttribute('aria-busy','true');
    link.setAttribute('aria-disabled','true');
    const button = link.querySelector('button');
    if (button) button.disabled = true;
    const status = document.createElement('span');
    status.setAttribute('role','status');
    status.style.cssText = 'display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap';
    const progress = document.createElement('progress');
    progress.setAttribute('aria-label','Preparing pitch speed video');
    progress.style.width = '120px';
    status.append(progress,document.createTextNode(new URL(href).pathname.startsWith('/download/') ? 'Retrieving saved export...' : 'Preparing pitch speed video...'));
    link.after(status);
    try {
      const response = await fetch(href);
      if (!response.ok) {
        const result = await response.json().catch(()=>null);
        throw new Error(result?.error || 'Could not export pitch speed. Please retry.');
      }
      const blob = await response.blob();
      const savedUrl = new URL(href); savedUrl.pathname = '/download/pitch-speed';
      link.href = savedUrl.href;
      if (button) button.textContent = 'Download Saved Export';
      else link.textContent = 'Download Saved Export';
      const scope = link.closest('.card-row') || document;
      scope.querySelector('[data-pitch-speed-review]')?.remove();
      document.dispatchEvent(new CustomEvent('pitch-speed-export-saved',{detail:{id:Number(savedUrl.searchParams.get('id')),url:savedUrl.href}}));
      const url = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = url;
      download.download = 'pitch_' + new URL(href).searchParams.get('id') + '_speed.mp4';
      document.body.append(download); download.click(); download.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      status.textContent = 'Download ready.';
    } catch(error) {
      status.textContent = error.message;
      status.setAttribute('role','alert');
    } finally {
      pending.delete(href);
      link.removeAttribute('aria-busy'); link.removeAttribute('aria-disabled');
      if (button) button.disabled = false;
      // Replace the previous message on a retry instead of accumulating status rows.
      link.addEventListener('click',()=>status.remove(),{once:true});
    }
  });
})();
