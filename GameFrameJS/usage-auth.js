const crypto = require("crypto");

const DESKTOP_MODE = process.env.GAMEFRAME_DESKTOP === "1";
const API_BASE_URL = String(process.env.GAMEFRAME_API_URL || "").replace(/\/$/, "");
const TRIAL_MATCHUP_LIMIT = Math.max(1, Number(process.env.TRIAL_MATCHUP_LIMIT || 3));
const TRIAL_DAYS = Math.max(1, Number(process.env.TRIAL_DAYS || 14));

function authCodeSecret() {
  const configured = String(process.env.AUTH_CODE_SECRET || "");
  if (configured) return configured;
  if (process.env.AUTH_ALLOW_DEV_CODE === "true" && process.env.NODE_ENV !== "production") return "gameframe-development-only";
  throw new Error("AUTH_CODE_SECRET is required for authentication.");
}

function validateProductionConfiguration() {
  if (DESKTOP_MODE || process.env.NODE_ENV !== "production") return [];
  const required = ["AUTH_CODE_SECRET", "RESEND_API_KEY", "AUTH_FROM_EMAIL", "ADMIN_API_KEY"];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (process.env.AUTH_ALLOW_DEV_CODE === "true") missing.push("AUTH_ALLOW_DEV_CODE must be disabled");
  if (missing.length && process.env.GAMEFRAME_ENFORCE_PRODUCTION_CONFIG === "true") {
    throw new Error(`Unsafe production authentication configuration: ${missing.join(", ")}`);
  }
  if (missing.length) console.error(`Production configuration is incomplete: ${missing.join(", ")}`);
  return missing;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeEmail(raw) {
  const email = String(raw || "").trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return "";
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    local = local.split("+")[0].replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

function ensureUsageSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_accounts (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      normalized_email TEXT NOT NULL UNIQUE,
      email_verified_at TEXT,
      trial_started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      disabled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_codes (
      id TEXT PRIMARY KEY,
      normalized_email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      consumed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS auth_codes_email_created
      ON auth_codes (normalized_email, created_at DESC);

    CREATE TABLE IF NOT EXISTS registered_devices (
      device_hash TEXT PRIMARY KEY,
      first_account_id TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      app_version TEXT,
      disabled_at TEXT
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL,
      device_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS auth_sessions_account
      ON auth_sessions (account_id, expires_at);

    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product_code TEXT NOT NULL DEFAULT 'season_pass',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      matchup_limit INTEGER NOT NULL DEFAULT 500,
      device_limit INTEGER NOT NULL DEFAULT 2,
      stripe_customer_id TEXT,
      stripe_payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS licenses_account_status
      ON licenses (account_id, status, expires_at);

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      account_id TEXT NOT NULL,
      device_hash TEXT NOT NULL,
      license_id TEXT,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      app_version TEXT,
      processing_ms INTEGER,
      error_code TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS usage_events_account_type
      ON usage_events (account_id, event_type, created_at);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  const authCodeColumns = db.prepare("PRAGMA table_info(auth_codes)").all();
  if (!authCodeColumns.some((column) => column.name === "request_ip_hash")) {
    db.exec("ALTER TABLE auth_codes ADD COLUMN request_ip_hash TEXT");
  }
}

function setting(db, key) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(key);
  return row ? row.value : "";
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(key, String(value || ""));
}

function clearDesktopAuth(db) {
  db.prepare("DELETE FROM app_settings WHERE key IN ('auth_token', 'auth_email', 'auth_account_id')").run();
}

async function sendLoginCode(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;
  if (!apiKey || !from) {
    if (process.env.AUTH_ALLOW_DEV_CODE === "true") return { development: true };
    throw new Error("Email delivery is not configured.");
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your GameFrame sign-in code",
      text: `Your GameFrame sign-in code is ${code}. It expires in 10 minutes.`,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("The sign-in email could not be sent.");
  return { development: false };
}

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function authenticatedSession(db, req) {
  const token = bearerToken(req);
  if (!token) return null;
  return db.prepare(`
    SELECT s.*, a.email, a.normalized_email, a.trial_started_at
    FROM auth_sessions s
    JOIN auth_accounts a ON a.id=s.account_id
    JOIN registered_devices d ON d.device_hash=s.device_hash
    WHERE s.token_hash=?
      AND s.revoked_at IS NULL
      AND s.expires_at > datetime('now')
      AND a.disabled_at IS NULL
      AND d.disabled_at IS NULL
  `).get(sha256(token)) || null;
}

function adminAuthorized(req) {
  const configured = String(process.env.ADMIN_API_KEY || "");
  const supplied = String(req.headers["x-admin-key"] || "");
  if (!configured || !supplied) return false;
  return crypto.timingSafeEqual(Buffer.from(sha256(configured)), Buffer.from(sha256(supplied)));
}

function currentEntitlement(db, accountId, deviceHash) {
  db.prepare(`
    UPDATE usage_events SET status='failed', error_code='authorization_timeout', completed_at=datetime('now')
    WHERE status='authorized' AND created_at < datetime('now', '-2 hours')
  `).run();
  const license = db.prepare(`
    SELECT * FROM licenses
    WHERE account_id=? AND status='active'
      AND starts_at <= datetime('now') AND expires_at > datetime('now')
    ORDER BY expires_at DESC LIMIT 1
  `).get(accountId);

  if (license) {
    const deviceCount = db.prepare(`
      SELECT COUNT(DISTINCT device_hash) AS count
      FROM auth_sessions
      WHERE account_id=? AND revoked_at IS NULL AND expires_at > datetime('now')
    `).get(accountId).count;
    const used = db.prepare(`
      SELECT COUNT(*) AS count FROM usage_events
      WHERE license_id=? AND event_type='matchup_authorized' AND status <> 'failed'
    `).get(license.id).count;
    return {
      kind: "season_pass",
      allowed: Number(deviceCount) <= Number(license.device_limit) && Number(used) < Number(license.matchup_limit),
      used: Number(used),
      limit: Number(license.matchup_limit),
      remaining: Math.max(0, Number(license.matchup_limit) - Number(used)),
      expires_at: license.expires_at,
      license_id: license.id,
      device_limit_reached: Number(deviceCount) > Number(license.device_limit),
    };
  }

  const account = db.prepare(`
    SELECT trial_started_at, datetime(trial_started_at, ?) AS trial_expires_at
    FROM auth_accounts WHERE id=?
  `).get(`+${TRIAL_DAYS} days`, accountId);
  const device = db.prepare("SELECT first_account_id FROM registered_devices WHERE device_hash=?").get(deviceHash);
  const accountUsed = db.prepare(`
    SELECT COUNT(*) AS count FROM usage_events
    WHERE account_id=? AND license_id IS NULL AND event_type='matchup_authorized' AND status <> 'failed'
  `).get(accountId).count;
  const deviceUsed = db.prepare(`
    SELECT COUNT(*) AS count FROM usage_events
    WHERE device_hash=? AND license_id IS NULL AND event_type='matchup_authorized' AND status <> 'failed'
  `).get(deviceHash).count;
  const used = Math.max(Number(accountUsed), Number(deviceUsed));
  const trialActive = !!(account && account.trial_started_at) && !!db.prepare(`
    SELECT 1 AS active FROM auth_accounts
    WHERE id=? AND trial_started_at > datetime('now', ?)
  `).get(accountId, `-${TRIAL_DAYS} days`);
  const originalDeviceAccount = !device || device.first_account_id === accountId;
  return {
    kind: "trial",
    allowed: trialActive && originalDeviceAccount && used < TRIAL_MATCHUP_LIMIT,
    used,
    limit: TRIAL_MATCHUP_LIMIT,
    remaining: Math.max(0, TRIAL_MATCHUP_LIMIT - used),
    starts_at: account ? account.trial_started_at : null,
    expires_at: account ? account.trial_expires_at : null,
    license_id: null,
    device_already_trialed: !originalDeviceAccount,
  };
}

async function cloudRequest(path, options = {}) {
  if (!API_BASE_URL) throw new Error("GameFrame online services are not configured.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "GameFrame online services could not complete the request.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

function installUsageAuth(app, db) {
  validateProductionConfiguration();
  ensureUsageSchema(db);

  app.post("/api/v1/auth/request-code", async (req, res) => {
    const email = String(req.body.email || "").trim();
    const normalized = normalizeEmail(email);
    if (!normalized || normalized.length > 254) return res.status(400).json({ error: "Enter a valid email address." });
    const requestIpHash = sha256(String(req.ip || req.socket.remoteAddress || "unknown"));
    const recentFromIp = db.prepare(`
      SELECT COUNT(*) AS count FROM auth_codes
      WHERE request_ip_hash=? AND created_at > datetime('now', '-15 minutes')
    `).get(requestIpHash).count;
    if (Number(recentFromIp) >= 10) return res.status(429).json({ error: "Too many sign-in requests. Please wait 15 minutes." });
    const recent = db.prepare(`
      SELECT COUNT(*) AS count FROM auth_codes
      WHERE normalized_email=? AND created_at > datetime('now', '-15 minutes')
    `).get(normalized).count;
    if (Number(recent) >= 3) return res.status(429).json({ error: "Please wait before requesting another code." });

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    let secret;
    try { secret = authCodeSecret(); } catch (error) { return res.status(503).json({ error: "Sign-in is temporarily unavailable." }); }
    db.prepare(`
      INSERT INTO auth_codes (id, normalized_email, code_hash, expires_at, request_ip_hash)
      VALUES (?, ?, ?, datetime('now', '+10 minutes'), ?)
    `).run(crypto.randomUUID(), normalized, sha256(`${secret}:${normalized}:${code}`), requestIpHash);
    try {
      const sent = await sendLoginCode(email, code);
      res.json({ sent: true, development_code: sent.development ? code : undefined });
    } catch (error) {
      res.status(503).json({ error: error.message });
    }
  });

  app.post("/api/v1/auth/verify-code", (req, res) => {
    const email = String(req.body.email || "").trim();
    const normalized = normalizeEmail(email);
    const code = String(req.body.code || "").trim();
    const deviceHash = String(req.body.device_id || "").trim();
    const appVersion = String(req.body.app_version || "").slice(0, 40);
    if (!normalized || !/^\d{6}$/.test(code) || deviceHash.length < 16) {
      return res.status(400).json({ error: "The email, code, or device registration is invalid." });
    }
    const record = db.prepare(`
      SELECT * FROM auth_codes
      WHERE normalized_email=? AND consumed_at IS NULL AND expires_at > datetime('now') AND attempts < 5
      ORDER BY created_at DESC LIMIT 1
    `).get(normalized);
    if (!record) return res.status(401).json({ error: "That code is invalid or expired." });
    let secret;
    try { secret = authCodeSecret(); } catch (_) { return res.status(503).json({ error: "Sign-in is temporarily unavailable." }); }
    const expected = sha256(`${secret}:${normalized}:${code}`);
    if (!crypto.timingSafeEqual(Buffer.from(record.code_hash), Buffer.from(expected))) {
      db.prepare("UPDATE auth_codes SET attempts=attempts+1 WHERE id=?").run(record.id);
      return res.status(401).json({ error: "That code is invalid or expired." });
    }

    const transaction = db.transaction(() => {
      db.prepare("UPDATE auth_codes SET consumed_at=datetime('now') WHERE id=?").run(record.id);
      let account = db.prepare("SELECT * FROM auth_accounts WHERE normalized_email=?").get(normalized);
      if (!account) {
        const id = crypto.randomUUID();
        db.prepare(`
          INSERT INTO auth_accounts (id, email, normalized_email, email_verified_at, trial_started_at)
          VALUES (?, ?, ?, datetime('now'), datetime('now'))
        `).run(id, email, normalized);
        account = db.prepare("SELECT * FROM auth_accounts WHERE id=?").get(id);
      } else {
        db.prepare("UPDATE auth_accounts SET email=?, email_verified_at=datetime('now') WHERE id=?").run(email, account.id);
      }
      db.prepare(`
        INSERT INTO registered_devices (device_hash, first_account_id, app_version)
        VALUES (?, ?, ?)
        ON CONFLICT(device_hash) DO UPDATE SET last_seen_at=datetime('now'), app_version=excluded.app_version
      `).run(deviceHash, account.id, appVersion);
      const token = crypto.randomBytes(32).toString("base64url");
      db.prepare(`
        INSERT INTO auth_sessions (id, token_hash, account_id, device_hash, expires_at)
        VALUES (?, ?, ?, ?, datetime('now', '+30 days'))
      `).run(crypto.randomUUID(), sha256(token), account.id, deviceHash);
      return { token, account };
    });

    const result = transaction();
    const entitlement = currentEntitlement(db, result.account.id, deviceHash);
    res.json({ access_token: result.token, account: { id: result.account.id, email }, entitlement });
  });

  app.get("/api/v1/license/status", (req, res) => {
    const session = authenticatedSession(db, req);
    if (!session) return res.status(401).json({ error: "Sign in again.", code: "AUTH_REQUIRED" });
    db.prepare("UPDATE auth_sessions SET last_seen_at=datetime('now') WHERE id=?").run(session.id);
    const devices = db.prepare(`
      SELECT s.device_hash, MAX(s.last_seen_at) AS last_seen_at, MAX(d.app_version) AS app_version
      FROM auth_sessions s
      LEFT JOIN registered_devices d ON d.device_hash=s.device_hash
      WHERE s.account_id=? AND s.revoked_at IS NULL AND s.expires_at > datetime('now')
      GROUP BY s.device_hash ORDER BY MAX(s.last_seen_at) DESC
    `).all(session.account_id).map((device) => ({
      id: device.device_hash,
      label: `Device …${String(device.device_hash).slice(-6)}`,
      last_seen_at: device.last_seen_at,
      app_version: device.app_version,
      current: device.device_hash === session.device_hash,
    }));
    res.json({ email: session.email, entitlement: currentEntitlement(db, session.account_id, session.device_hash), devices });
  });

  app.post("/api/v1/devices/revoke", (req, res) => {
    const session = authenticatedSession(db, req);
    if (!session) return res.status(401).json({ error: "Sign in again.", code: "AUTH_REQUIRED" });
    const deviceHash = String(req.body.device_id || "");
    if (!/^[a-f0-9]{32,128}$/i.test(deviceHash)) return res.status(400).json({ error: "Invalid device." });
    db.prepare(`
      UPDATE auth_sessions SET revoked_at=datetime('now')
      WHERE account_id=? AND device_hash=? AND revoked_at IS NULL
    `).run(session.account_id, deviceHash);
    res.json({ ok: true, signed_out_current_device: deviceHash === session.device_hash });
  });

  app.post("/api/v1/usage/authorize", (req, res) => {
    const session = authenticatedSession(db, req);
    if (!session) return res.status(401).json({ error: "Sign in again.", code: "AUTH_REQUIRED" });
    const requestId = String(req.body.request_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return res.status(400).json({ error: "Invalid request identifier." });
    const prior = db.prepare("SELECT * FROM usage_events WHERE request_id=?").get(requestId);
    if (prior) {
      const entitlement = currentEntitlement(db, session.account_id, session.device_hash);
      return res.json({ authorized: true, usage_id: prior.id, entitlement, duplicate: true });
    }
    const entitlement = currentEntitlement(db, session.account_id, session.device_hash);
    if (!entitlement.allowed) {
      return res.status(402).json({
        error: entitlement.device_already_trialed
          ? "This computer has already used its GameFrame trial."
          : entitlement.device_limit_reached
            ? "This Season Pass has reached its device limit."
            : "Your GameFrame matchup allowance has been reached.",
        code: "ALLOWANCE_REACHED",
        entitlement,
      });
    }
    const usageId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO usage_events
        (id, request_id, account_id, device_hash, license_id, event_type, status, app_version)
      VALUES (?, ?, ?, ?, ?, 'matchup_authorized', 'authorized', ?)
    `).run(usageId, requestId, session.account_id, session.device_hash, entitlement.license_id, String(req.body.app_version || "").slice(0, 40));
    res.json({
      authorized: true,
      usage_id: usageId,
      entitlement: currentEntitlement(db, session.account_id, session.device_hash),
    });
  });

  app.post("/api/v1/usage/complete", (req, res) => {
    const session = authenticatedSession(db, req);
    if (!session) return res.status(401).json({ error: "Sign in again.", code: "AUTH_REQUIRED" });
    const usageId = String(req.body.usage_id || "");
    const status = req.body.success === false ? "failed" : "completed";
    const changed = db.prepare(`
      UPDATE usage_events
      SET status=?, processing_ms=?, error_code=?, completed_at=datetime('now')
      WHERE id=? AND account_id=? AND device_hash=?
    `).run(
      status,
      Math.max(0, Number(req.body.processing_ms || 0)),
      String(req.body.error_code || "").slice(0, 80) || null,
      usageId,
      session.account_id,
      session.device_hash
    );
    if (!changed.changes) return res.status(404).json({ error: "Usage authorization was not found." });
    res.json({ recorded: true });
  });

  app.get("/api/v1/admin/usage", (req, res) => {
    if (!adminAuthorized(req)) return res.status(401).json({ error: "Unauthorized." });
    const totals = {
      verified_accounts: db.prepare("SELECT COUNT(*) AS count FROM auth_accounts WHERE email_verified_at IS NOT NULL").get().count,
      registered_devices: db.prepare("SELECT COUNT(*) AS count FROM registered_devices WHERE disabled_at IS NULL").get().count,
      active_licenses: db.prepare("SELECT COUNT(*) AS count FROM licenses WHERE status='active' AND expires_at > datetime('now')").get().count,
      authorized_matchups: db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE event_type='matchup_authorized'").get().count,
      completed_matchups: db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE event_type='matchup_authorized' AND status='completed'").get().count,
      failed_matchups: db.prepare("SELECT COUNT(*) AS count FROM usage_events WHERE event_type='matchup_authorized' AND status='failed'").get().count,
    };
    const accounts = db.prepare(`
      SELECT a.id, a.email, a.email_verified_at, a.trial_started_at,
             COUNT(DISTINCT s.device_hash) AS devices,
             COUNT(DISTINCT u.id) AS authorized_matchups,
             MAX(u.created_at) AS last_matchup_at,
             MAX(l.expires_at) AS license_expires_at
      FROM auth_accounts a
      LEFT JOIN auth_sessions s ON s.account_id=a.id AND s.revoked_at IS NULL
      LEFT JOIN usage_events u ON u.account_id=a.id AND u.event_type='matchup_authorized'
      LEFT JOIN licenses l ON l.account_id=a.id AND l.status='active' AND l.expires_at > datetime('now')
      GROUP BY a.id
      ORDER BY COALESCE(MAX(u.created_at), a.created_at) DESC
      LIMIT 250
    `).all();
    res.json({ totals, accounts });
  });

  app.post("/api/v1/admin/licenses", (req, res) => {
    if (!adminAuthorized(req)) return res.status(401).json({ error: "Unauthorized." });
    const normalized = normalizeEmail(req.body.email);
    const account = db.prepare("SELECT * FROM auth_accounts WHERE normalized_email=?").get(normalized);
    if (!account) return res.status(404).json({ error: "That customer must sign in once before a license can be granted." });
    const months = Math.max(1, Math.min(24, Number(req.body.months || 6)));
    const matchupLimit = Math.max(1, Math.min(100000, Number(req.body.matchup_limit || 500)));
    const deviceLimit = Math.max(1, Math.min(20, Number(req.body.device_limit || 2)));
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO licenses
        (id, account_id, product_code, status, starts_at, expires_at, matchup_limit, device_limit, stripe_customer_id, stripe_payment_id)
      VALUES (?, ?, 'season_pass', 'active', datetime('now'), datetime('now', ?), ?, ?, ?, ?)
    `).run(
      id,
      account.id,
      `+${months} months`,
      matchupLimit,
      deviceLimit,
      String(req.body.stripe_customer_id || "").slice(0, 100) || null,
      String(req.body.stripe_payment_id || "").slice(0, 100) || null
    );
    res.status(201).json({
      license: db.prepare("SELECT * FROM licenses WHERE id=?").get(id),
      account: { id: account.id, email: account.email },
    });
  });

  app.get("/auth/login", (req, res) => {
    if (!DESKTOP_MODE) return res.redirect(302, "/");
    res.render("auth_login.html", {
      desktop_mode: true,
      auth_email: setting(db, "auth_email"),
      step: req.query.step || "email",
      email: req.query.email || "",
      message: req.query.message || "",
    });
  });

  app.post("/auth/request-code", async (req, res) => {
    if (!DESKTOP_MODE) return res.status(404).end();
    const email = String(req.body.email || "").trim();
    try {
      const data = await cloudRequest("/api/v1/auth/request-code", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const params = new URLSearchParams({ step: "code", email });
      if (data.development_code) params.set("message", `Development code: ${data.development_code}`);
      res.redirect(303, `/auth/login?${params}`);
    } catch (error) {
      res.redirect(303, `/auth/login?${new URLSearchParams({ email, message: error.message })}`);
    }
  });

  app.post("/auth/verify-code", async (req, res) => {
    if (!DESKTOP_MODE) return res.status(404).end();
    const email = String(req.body.email || "").trim();
    try {
      const data = await cloudRequest("/api/v1/auth/verify-code", {
        method: "POST",
        body: JSON.stringify({
          email,
          code: req.body.code,
          device_id: process.env.GAMEFRAME_DEVICE_ID,
          app_version: process.env.GAMEFRAME_APP_VERSION || process.env.npm_package_version || "1.0.0",
        }),
      });
      setSetting(db, "auth_token", data.access_token);
      setSetting(db, "auth_email", data.account.email);
      setSetting(db, "auth_account_id", data.account.id);
      res.redirect(303, setting(db, "onboarding_complete") === "1" ? "/" : "/getting-started");
    } catch (error) {
      res.redirect(303, `/auth/login?${new URLSearchParams({ step: "code", email, message: error.message })}`);
    }
  });

  app.get("/auth/logout", (req, res) => {
    if (DESKTOP_MODE) clearDesktopAuth(db);
    res.redirect(302, DESKTOP_MODE ? "/auth/login" : "/");
  });

  app.get("/account", async (req, res) => {
    if (!DESKTOP_MODE) return res.redirect(302, "/");
    const email = setting(db, "auth_email");
    const token = setting(db, "auth_token");
    let entitlement = null;
    let statusError = String(req.query.error || "");
    let release = null;
    let devices = [];
    if (token) {
      try {
        const data = await cloudRequest("/api/v1/license/status", { headers: { Authorization: `Bearer ${token}` } });
        entitlement = data.entitlement;
        devices = Array.isArray(data.devices) ? data.devices : [];
        release = await cloudRequest("/health").catch(() => null);
      } catch (error) {
        statusError = error.message;
      }
    }
    const currentVersion = process.env.GAMEFRAME_APP_VERSION || process.env.npm_package_version || "1.0.0";
    res.render("account.html", {
      desktop_mode: true,
      auth_email: email,
      onboarding_complete: setting(db, "onboarding_complete") === "1",
      entitlement,
      status_error: statusError,
      current_version: currentVersion,
      latest_version: release && release.version,
      update_available: !!(release && release.version && release.version !== currentVersion),
      download_url: release && release.download_url,
      devices,
    });
  });

  app.post("/account/device/revoke", async (req, res) => {
    if (!DESKTOP_MODE) return res.status(404).end();
    const token = setting(db, "auth_token");
    try {
      const data = await cloudRequest("/api/v1/devices/revoke", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ device_id: req.body.device_id }),
      });
      if (data.signed_out_current_device) {
        clearDesktopAuth(db);
        return res.redirect(303, "/auth/login?message=This+device+was+removed.");
      }
      res.redirect(303, "/account");
    } catch (error) {
      res.redirect(303, `/account?error=${encodeURIComponent(error.message)}`);
    }
  });

  app.get("/getting-started", (req, res) => {
    if (!DESKTOP_MODE) return res.redirect(302, "/");
    res.render("getting_started.html", {
      desktop_mode: true,
      auth_email: setting(db, "auth_email"),
      onboarding_complete: setting(db, "onboarding_complete") === "1",
      counts: {
        teams: db.prepare("SELECT COUNT(*) AS count FROM teams").get().count,
        hitters: db.prepare("SELECT COUNT(*) AS count FROM hitters").get().count,
        pitchers: db.prepare("SELECT COUNT(*) AS count FROM pitchers").get().count,
        swings: db.prepare("SELECT COUNT(*) AS count FROM swing_clips").get().count,
        pitches: db.prepare("SELECT COUNT(*) AS count FROM pitch_clips").get().count,
        matchups: db.prepare("SELECT COUNT(*) AS count FROM matchups").get().count,
      },
    });
  });

  app.post("/getting-started/complete", (req, res) => {
    if (!DESKTOP_MODE) return res.status(404).end();
    setSetting(db, "onboarding_complete", "1");
    res.redirect(303, "/");
  });

  app.use((req, res, next) => {
    res.locals.desktop_mode = DESKTOP_MODE;
    res.locals.auth_email = DESKTOP_MODE ? setting(db, "auth_email") : "";
    res.locals.onboarding_complete = !DESKTOP_MODE || setting(db, "onboarding_complete") === "1";
    if (!DESKTOP_MODE) return next();
    const publicPath = req.path.startsWith("/static/") || req.path.startsWith("/auth/") || req.path.startsWith("/api/v1/") || ["/manifest.json", "/service-worker.js"].includes(req.path);
    if (publicPath || setting(db, "auth_token")) return next();
    if (req.method === "GET") return res.redirect(302, "/auth/login");
    return res.status(401).json({ error: "Sign in to GameFrame first.", code: "AUTH_REQUIRED" });
  });
}

async function authorizeDesktopMatchup(db, requestId) {
  if (!DESKTOP_MODE) return null;
  const token = setting(db, "auth_token");
  if (!token) {
    const error = new Error("Sign in to GameFrame before creating a matchup.");
    error.status = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  return cloudRequest("/api/v1/usage/authorize", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ request_id: requestId, app_version: process.env.GAMEFRAME_APP_VERSION || process.env.npm_package_version || "1.0.0" }),
  });
}

async function completeDesktopMatchup(db, usageId, success, processingMs, errorCode) {
  if (!DESKTOP_MODE || !usageId) return;
  const token = setting(db, "auth_token");
  if (!token) return;
  await cloudRequest("/api/v1/usage/complete", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ usage_id: usageId, success, processing_ms: processingMs, error_code: errorCode }),
  });
}

module.exports = {
  installUsageAuth,
  authorizeDesktopMatchup,
  completeDesktopMatchup,
};
