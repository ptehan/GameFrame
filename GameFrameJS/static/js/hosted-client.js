/* Loaded before workflow scripts; customer data and tokens are never cached. */
(() => {
  window.GAMEFRAME_HOSTED = true;
  const token = document.querySelector('meta[name="gameframe-csrf"]').content;
  const original = window.fetch.bind(window);
  window.fetch = async function(input, options = {}) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const method = (options.method || input?.method || 'GET').toUpperCase();
    if (url.origin === location.origin && !['GET', 'HEAD'].includes(method)) {
      options = { ...options, headers: new Headers(options.headers || input?.headers || {}) };
      options.headers.set('X-CSRF-Token', token);
      if (['/api/predict', '/matchup/create'].includes(url.pathname)) {
        const response = await original('/api/account', { cache: 'no-store' });
        if (!response.ok) throw Error('Sign in before processing.');
        const account = await response.json();
        if (!account.processing_allowed || !account.remaining) throw Error('Your processing allowance is exhausted or expired. Open Account to manage your plan.');
        if (!confirm(`This run uses 1 processing credit. You have ${account.remaining} remaining. Continue?`)) throw new DOMException('Processing canceled', 'AbortError');
        options.headers.set('Idempotency-Key', crypto.randomUUID());
      }
    }
    return original(input, options);
  };
  function secureForm(form) {
    const url = new URL(form.action, location.href);
    if (form.method.toLowerCase() === 'post' && url.origin === location.origin) {
      url.searchParams.set('csrf', token); form.action = url.href;
    }
  }
  document.addEventListener('submit', event => secureForm(event.target), true);
  const submit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function() { secureForm(this); return submit.call(this); };
  // Local drafts contain customer footage. Clear them when the signed-in account
  // changes, including when two customers use the same browser.
  original('/api/account').then(r => r.json()).then(async account => {
    const previous = localStorage.getItem('gameframe.hosted-account');
    if (previous && previous !== account.email) {
      for (const key of Object.keys(localStorage)) if (/gameframe|^gf[._-]/i.test(key)) localStorage.removeItem(key);
      if (indexedDB.databases) for (const db of await indexedDB.databases()) {
        if (/gameframe|^gf[._-]/i.test(db.name || '')) indexedDB.deleteDatabase(db.name);
      }
      sessionStorage.clear();
    }
    localStorage.setItem('gameframe.hosted-account', account.email);
  }).catch(() => {});
})();
