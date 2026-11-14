const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { installUsageAuth, ensureUsageSchema, authenticatedSession, normalizeEmail } = require('../usage-auth');
const { createApplication } = require('../server');
const store = require('./store');
const { installBilling } = require('./billing');

function createHostedApplication(options = {}) {
  const directory = path.resolve(options.directory || process.env.GAMEFRAME_DATA_DIR || path.join(__dirname, '..', 'hosted-data'));
  const origin = options.origin || process.env.APP_ORIGIN;
  if (!origin || new URL(origin).origin !== origin) throw new Error('APP_ORIGIN must be an exact origin without a trailing slash');
  const production = process.env.NODE_ENV === 'production';
  if (production && !origin.startsWith('https://')) throw new Error('Hosted production requires HTTPS');
  if (production && (process.env.AUTH_ALLOW_DEV_CODE === 'true' || !process.env.RESEND_API_KEY || !process.env.AUTH_FROM_EMAIL || !process.env.ADMIN_API_KEY)) {
    throw new Error('Hosted production requires configured authentication, email and administration; development codes must be disabled');
  }
  fs.mkdirSync(directory, { recursive: true });
  const db = new Database(path.join(directory, 'accounts.db'));
  ensureUsageSchema(db); store.initialize(db); store.recover(db);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  const workspaces = new Map();
  let tail = Promise.resolve();
  let activeWorker;
  let operations;
  const recentErrors = [];
  app.use((req, res, next) => {
    res.once('finish', () => {
      if (res.statusCode < 500) return;
      const now = Date.now();
      while (recentErrors.length && recentErrors[0] < now - 600000) recentErrors.shift();
      recentErrors.push(now);
      if (recentErrors.length >= 5) void operations?.alert('Five or more server errors occurred in ten minutes. Inspect service logs.');
    });
    next();
  });
  function exclusive(work) {
    const pending = tail.then(work);
    tail = pending.catch(() => {});
    return pending;
  }
  const secret = process.env.AUTH_CODE_SECRET;
  if (!secret) throw new Error('AUTH_CODE_SECRET is required');
  function csrfToken(session) { return crypto.createHmac('sha256', secret).update(session.id).digest('hex'); }
  function sessionFor(req) {
    const raw = String(req.headers.cookie || '').split(';').find(c => c.trim().startsWith('gf_session='));
    const token = raw?.trim().slice('gf_session='.length);
    if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) return null;
    return authenticatedSession(db, { headers: { authorization: `Bearer ${token}` } });
  }
  function requireSession(req, res, next) {
    req.account = sessionFor(req);
    if (!req.account) return res.status(401).json({ error: 'Sign in to GameFrame', code: 'AUTH_REQUIRED' });
    next();
  }
  function csrf(req, res, next) {
    if (req.headers.origin !== origin) return res.status(403).json({ error: 'Request origin rejected' });
    const supplied = req.headers['x-csrf-token'] || req.query.csrf;
    if (!req.account || supplied !== csrfToken(req.account)) return res.status(403).json({ error: 'Refresh the page and try again', code: 'CSRF_REQUIRED' });
    next();
  }
  function salesOpen() {
    return process.env.GAMEFRAME_SALES_OPEN === 'true' && process.env.GAMEFRAME_LEGAL_PUBLISHED === 'true' && store.missingGates(db).length === 0;
  }
  const stripe = options.stripe || (process.env.STRIPE_SECRET_KEY ? new (require('stripe'))(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 20000 }) : null);
  const billing = installBilling(app, { db, stripe, origin,
    priceId: options.priceId || process.env.STRIPE_PRICE_ID,
    webhookSecret: options.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
    requireSession, csrf, salesOpen });
  app.use(express.json({ limit: '8mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.get('/health', (req, res) => {
    const ready = !production || fs.existsSync(process.env.GAMEFRAME_SYNTHETIC_DB || '');
    res.status(ready ? 200 : 503).json({ ok: ready, hosted: true, registration_open: salesOpen() });
  });
  app.get('/api/admin/status', (req, res) => {
    const expected = process.env.ADMIN_API_KEY, supplied = req.headers['x-admin-key'];
    const digest = value => crypto.createHash('sha256').update(String(value || '')).digest();
    if (!expected || !supplied || !crypto.timingSafeEqual(digest(expected), digest(supplied))) return res.sendStatus(403);
    res.json({ missing_gates: store.missingGates(db), operations: operations?.status() || { enabled: false },
      memory_bytes: process.memoryUsage().rss, active_jobs: db.prepare("SELECT kind,state,created_at FROM hosted_jobs WHERE state IN ('queued','running')").all() });
  });
  app.get('/auth/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
  require('./legal').installLegal(app);
  app.use('/static', express.static(path.join(__dirname, '..', 'static'), { dotfiles: 'deny', index: false,
    setHeaders: res => res.setHeader('Cross-Origin-Resource-Policy', 'same-origin') }));
  app.use('/api/v1', (req, res, next) => {
    if (!['/auth/request-code', '/auth/verify-code'].includes(req.path) || req.method !== 'POST') return res.sendStatus(404);
    if (req.headers.origin !== origin) return res.sendStatus(403);
    // Device identifiers are generated by the trusted gateway, not supplied by clients.
    req.body.device_id = crypto.createHmac('sha256', secret).update(normalizeEmail(req.body.email)).digest('hex');
    next();
  });
  installUsageAuth(app, db, {
    apiOnly: true,
    allowLogin(email) {
      const existing = db.prepare('SELECT disabled_at FROM auth_accounts WHERE normalized_email=?').get(email);
      if (existing) return existing.disabled_at ? 'Account disabled. Contact support.' : null;
      const invited = Boolean(db.prepare('SELECT email FROM hosted_invites WHERE email=?').get(email));
      if (!invited && !salesOpen()) return 'GameFrame is invitation-only while release checks are completed.';
      const cap = salesOpen() ? 25 : 10;
      return db.prepare('SELECT COUNT(*) n FROM auth_accounts').get().n >= cap ? 'The beta is full. Please contact support.' : null;
    },
    onVerified(req, res, result) {
      res.cookie('gf_session', result.token, { httpOnly: true, secure: production, sameSite: 'strict', maxAge: 30 * 86400000, path: '/' });
      res.json({ account: { id: result.account.id, email: result.account.email } });
    },
  });
  function workspaceFor(accountId) {
    if (!/^[a-f0-9-]{36}$/.test(accountId)) throw new Error('Invalid workspace identifier');
    if (workspaces.has(accountId)) return workspaces.get(accountId);
    const dataDirectory = path.join(directory, 'workspaces', accountId);
    fs.mkdirSync(dataDirectory, { recursive: true });
    const databasePath = path.join(dataDirectory, 'app.db');
    const workspace = createApplication({ databasePath, dataDirectory, hostedWorkspace: true,
      storageLimit: () => store.entitlement(db, accountId).storage_limit });
    workspaces.set(accountId, workspace);
    return workspace;
  }
  if (options.operations !== false && production) operations = require('./operations').installOperations({ db, directory, exclusive, reconcile: billing.reconcile,
    evict(accountId) { const workspace = workspaces.get(accountId); if (workspace) workspace.closeDatabase(); workspaces.delete(accountId); } });
  app.get('/api/account', requireSession, (req, res) => {
    const access = store.entitlement(db, req.account.account_id);
    res.json({ email: req.account.email, csrf: csrfToken(req.account), ...access,
      has_billing_account: Boolean(db.prepare('SELECT customer_id FROM hosted_billing WHERE account_id=?').get(req.account.account_id)?.customer_id),
      storage_used: store.diskBytes(path.join(directory, 'workspaces', req.account.account_id)),
      sales_open: salesOpen(), limits: store.LIMITS });
  });
  app.get('/api/jobs', requireSession, (req, res) => {
    const labels = { ev: 'EV analysis', matchup: 'Matchup render', '/api/clip': 'EV video export',
      '/api/track': 'Ball tracking', '/api/landmarks': 'Field landmarks', '/api/gameframe/save-hit': 'Save EV video',
      '/api/gameframe/retry-ev-video': 'Retry EV video', '/api/pitch-release/preview': 'Pitch frame review' };
    res.json(db.prepare('SELECT id,kind,state,created_at,completed_at,error FROM hosted_jobs WHERE account_id=? ORDER BY created_at DESC LIMIT 25')
      .all(req.account.account_id).map(job => ({ ...job, kind: labels[job.kind] || 'Video preparation',
        error: job.error?.startsWith('HTTP ') ? 'The run did not complete; any reserved credit was returned.' : job.error })));
  });
  app.get('/account', (req, res) => {
    if (!sessionFor(req)) return res.redirect('/auth/login');
    res.sendFile(path.join(__dirname, 'account.html'));
  });
  app.post('/api/account/delete', requireSession, csrf, async (req, res, next) => {
    try {
      const accountId = req.account.account_id;
      const billing = db.prepare('SELECT subscription_id FROM hosted_billing WHERE account_id=?').get(accountId);
      if (billing?.subscription_id) {
        if (!stripe) throw Object.assign(new Error('Billing service is unavailable. Retry deletion when billing is restored.'), { status: 503 });
        const subscription = await stripe.subscriptions.retrieve(billing.subscription_id);
        if (subscription.status !== 'canceled') await stripe.subscriptions.update(billing.subscription_id, { cancel_at_period_end: true });
      }
      await require('./operations').email(req.account.email, 'GameFrame account deletion requested', 'Your account has been disabled. Its footage is scheduled for deletion in 30 days. Contact support before then if this was a mistake. Billing records and backups may remain for their published retention periods.');
      db.transaction(() => {
        db.prepare("UPDATE auth_accounts SET disabled_at=datetime('now') WHERE id=?").run(accountId);
        db.prepare("UPDATE auth_sessions SET revoked_at=datetime('now') WHERE account_id=?").run(accountId);
        db.prepare('INSERT OR REPLACE INTO hosted_deletions(account_id,delete_after,notice_at) VALUES(?,?,?)').run(accountId, Date.now() + 30 * 86400000, new Date().toISOString());
      })();
      res.clearCookie('gf_session', { path: '/' }).json({ deletion_scheduled: true });
    } catch (error) { next(error); }
  });
  app.post('/auth/logout', requireSession, csrf, (req, res) => {
    db.prepare("UPDATE auth_sessions SET revoked_at=datetime('now') WHERE id=?").run(req.account.id);
    res.clearCookie('gf_session', { path: '/', httpOnly: true, secure: production, sameSite: 'strict' });
    res.set('Clear-Site-Data', '"cache", "storage"').json({ logged_out: true });
  });
  app.get('/logout', (req, res) => res.redirect('/account'));
  app.use((req, res, next) => {
    req.account = sessionFor(req);
    if (!req.account) {
      if (req.method === 'GET' && String(req.headers.accept || '').includes('text/html') && !req.path.startsWith('/api/')) return res.redirect('/auth/login');
      return res.status(401).json({ error: 'Sign in first', code: 'AUTH_REQUIRED' });
    }
    const access = store.entitlement(db, req.account.account_id);
    if (!access.read_allowed) return res.status(403).json({ error: 'Retention period ended. Contact support about your data.' });
    if (!['GET', 'HEAD'].includes(req.method)) return csrf(req, res, next);
    next();
  });
  app.get('/api/demos', (req, res) => {
    try { res.json(require('./demos').list(process.env.GAMEFRAME_DEMO_DB)); } catch (error) { res.status(503).json({ error: 'Demo library unavailable' }); }
  });
  app.get('/api/demos/:type/:id', (req, res) => require('./demos').preview(process.env.GAMEFRAME_DEMO_DB, req.params.type, Number(req.params.id), req, res));
  app.post('/api/demos/copy', async (req, res, next) => {
    try {
      await exclusive(async () => {
        const id = req.account.account_id, access = store.entitlement(db, id);
        workspaceFor(id);
        require('./demos').copy(process.env.GAMEFRAME_DEMO_DB, path.join(directory, 'workspaces', id, 'app.db'), access.storage_limit);
      });
      res.json({ copied: true });
    } catch (error) { next(error); }
  });
  app.post('/api/storage/cleanup', async (req, res, next) => {
    try {
      const result = await exclusive(async () => {
        const id = req.account.account_id, workspace = workspaceFor(id);
        workspace.stopWorker();
        const result = require('./storage').cleanup(path.join(directory, 'workspaces', id));
        workspace.compact();
        return result;
      });
      res.json(result);
    } catch (error) { next(error); }
  });
  app.use((req, res, next) => {
    if (req.path === '/service-worker.js') return res.type('js').send("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith('gameframe-cache-'))await caches.delete(k);await self.registration.unregister()})()));");
    // Inject account navigation and same-origin CSRF handling into existing workflows.
    const send = res.send.bind(res);
    res.send = body => {
      if (typeof body === 'string' && (!res.get('Content-Type') || /text\/html/i.test(res.get('Content-Type'))) && /<html\b/i.test(body) && /<\/body>/i.test(body)) {
        const token = JSON.stringify(csrfToken(req.account));
        body = body.replace(/<head([^>]*)>/i, `<head$1><meta name="gameframe-csrf" content=${token}><script src="/static/js/hosted-client.js"></script>`);
        body = body.replace(/<\/body>/i, '<p style="padding:12px"><a href="/account">Account, billing &amp; remaining usage</a></p></body>');
      }
      return send(body);
    };
    next();
  });
  app.get('/ev/predictor.html', (req, res) => res.type('html').send(fs.readFileSync(path.join(__dirname, '..', 'ev-predictor', 'predictor.html'), 'utf8')));
  app.use(async (req, res, next) => {
    let job;
    let release;
    try {
      const accountId = req.account.account_id;
      const dataDirectory = path.join(directory, 'workspaces', accountId);
      const mutating = !['GET', 'HEAD'].includes(req.method);
      const pythonRequest = /^\/api\/(?:predict|track|landmarks|clip|gameframe)(?:\/|$)/.test(req.path);
      const metered = req.method === 'POST' && ['/api/predict', '/matchup/create'].includes(req.path);
      const processing = metered || req.method === 'POST' && /^\/(?:api\/(?:clip|track|landmarks|pitch-release\/preview|pitch-vision\/preview|gameframe\/(?:save-hit|retry-ev-video))|multi-(?:pitch|swing)\/(?:analyze|split|prepare-tag)|upload\/(?:pitch|swing)\/finalize)$/.test(req.path);
      if (mutating || pythonRequest) {
        const access = store.entitlement(db, accountId);
        const deleting = /(?:delete|remove)$/.test(req.path);
        if (mutating && !deleting && !access.processing_allowed) return res.status(402).json({ error: 'Your processing access has expired. Your library remains available for download.' });
        const bytes = Number(req.headers['content-length'] || 0);
        if (!Number.isFinite(bytes) || bytes < 0 || bytes > store.LIMITS.uploadBytes + 1024 ** 2) return res.sendStatus(413);
        if (mutating && !deleting && store.diskBytes(dataDirectory) + bytes > access.storage_limit) return res.status(413).json({ error: 'Storage allowance reached. Delete footage to free space.' });
        if (processing) {
          job = store.reserve(db, accountId, metered ? req.path === '/api/predict' ? 'ev' : 'matchup' : req.path,
            req.headers['idempotency-key'], metered);
          res.set('X-GameFrame-Job', job);
        }
        // One global mutation/processing lane prevents concurrent media writes.
        const previous = tail;
        tail = new Promise(resolve => { release = resolve; });
        await previous;
        if (res.destroyed) {
          if (job) store.finish(db, job, false, 'Client disconnected while queued');
          release(); return;
        }
        const current = store.entitlement(db, accountId);
        if (mutating && !deleting && !current.processing_allowed) throw Object.assign(new Error('Processing access expired while queued'), { status: 402 });
        if (mutating && !deleting && store.diskBytes(dataDirectory) + bytes > current.storage_limit) throw Object.assign(new Error('Storage allowance reached'), { status: 413 });
        if (job) db.prepare("UPDATE hosted_jobs SET state='running' WHERE id=?").run(job);
        let finished = false;
        const complete = () => {
          if (finished) return; finished = true;
          if (job) store.finish(db, job, res.writableFinished && res.statusCode >= 200 && res.statusCode < 300,
            res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null);
          release();
        };
        res.once('finish', complete);
        res.once('gameframe-work-complete', complete);
        const end = res.end;
        res.end = function(...args) { const result = end.apply(this, args); if (res.destroyed) complete(); return result; };
      }
      const workspace = workspaceFor(accountId);
      if (pythonRequest) {
        if (activeWorker && activeWorker !== workspace) activeWorker.stopWorker();
        activeWorker = workspace;
      }
      workspace.app(req, res, next);
    } catch (error) {
      if (job) store.finish(db, job, false, error.message);
      if (release) release();
      next(error);
    }
  });
  app.use((error, req, res, next) => {
    console.error('Hosted request failed:', error.message);
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'GameFrame could not complete the request.', code: 'HOSTED_REQUEST_FAILED' });
  });
  function close() {
    const dispose = () => { if (!db.open) return; for (const workspace of workspaces.values()) workspace.closeDatabase(); db.close(); };
    if (operations) return operations.close().then(dispose);
    dispose();
  }
  return { app, db, directory, close, billing, salesOpen };
}
function startHostedServer(port = Number(process.env.PORT || 8000), host) {
  const hosted = createHostedApplication();
  const server = hosted.app.listen(port, host, () => console.log(`GameFrame hosted service listening on ${port}`));
  server.once('close', hosted.close);
  return server;
}
module.exports = { createHostedApplication, startHostedServer };
