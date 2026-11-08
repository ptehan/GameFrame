const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

test("email authentication, trial usage, and device trial protection", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gameframe-auth-test-"));
  process.env.DB_PATH = path.join(directory, "test.db");
  process.env.AUTH_ALLOW_DEV_CODE = "true";
  process.env.AUTH_CODE_SECRET = "test-only-secret";
  process.env.TRIAL_MATCHUP_LIMIT = "3";
  process.env.ADMIN_API_KEY = "test-admin-key";
  delete process.env.GAMEFRAME_DESKTOP;

  const { startServer, closeDatabase } = require("../server");
  const server = startServer(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const deviceId = "a".repeat(64);

  async function request(pathname, body, token) {
    const response = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return { response, data: await response.json() };
  }

  async function login(email) {
    const requested = await request("/api/v1/auth/request-code", { email });
    assert.equal(requested.response.status, 200);
    assert.match(requested.data.development_code, /^\d{6}$/);
    const verified = await request("/api/v1/auth/verify-code", {
      email,
      code: requested.data.development_code,
      device_id: deviceId,
      app_version: "test",
    });
    assert.equal(verified.response.status, 200);
    return verified.data.access_token;
  }

  try {
    const firstToken = await login("parent+trial@gmail.com");
    for (let index = 0; index < 3; index += 1) {
      const authorized = await request("/api/v1/usage/authorize", {
        request_id: crypto.randomUUID(),
        app_version: "test",
      }, firstToken);
      assert.equal(authorized.response.status, 200);
      assert.equal(authorized.data.entitlement.remaining, 2 - index);
    }
    const exhausted = await request("/api/v1/usage/authorize", {
      request_id: crypto.randomUUID(),
      app_version: "test",
    }, firstToken);
    assert.equal(exhausted.response.status, 402);

    const secondToken = await login("different@example.com");
    const secondAccountAttempt = await request("/api/v1/usage/authorize", {
      request_id: crypto.randomUUID(),
      app_version: "test",
    }, secondToken);
    assert.equal(secondAccountAttempt.response.status, 402);
    assert.equal(secondAccountAttempt.data.entitlement.device_already_trialed, true);

    const unauthorizedAdmin = await fetch(`${base}/api/v1/admin/usage`);
    assert.equal(unauthorizedAdmin.status, 401);
    const usageReport = await fetch(`${base}/api/v1/admin/usage`, {
      headers: { "X-Admin-Key": "test-admin-key" },
    });
    assert.equal(usageReport.status, 200);
    assert.equal((await usageReport.json()).totals.authorized_matchups, 3);

    const license = await fetch(`${base}/api/v1/admin/licenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "test-admin-key" },
      body: JSON.stringify({ email: "different@example.com", months: 6, matchup_limit: 500, device_limit: 2 }),
    });
    assert.equal(license.status, 201);
    const paidAttempt = await request("/api/v1/usage/authorize", {
      request_id: crypto.randomUUID(),
      app_version: "test",
    }, secondToken);
    assert.equal(paidAttempt.response.status, 200);
    assert.equal(paidAttempt.data.entitlement.kind, "season_pass");

    const failedCompletion = await request("/api/v1/usage/complete", {
      usage_id: paidAttempt.data.usage_id,
      success: false,
      processing_ms: 1200,
      error_code: "TEST_FAILURE",
    }, secondToken);
    assert.equal(failedCompletion.response.status, 200);
    const restoredAllowance = await fetch(`${base}/api/v1/license/status`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });
    const restoredStatus = await restoredAllowance.json();
    assert.equal(restoredStatus.entitlement.used, 0);
    assert.equal(restoredStatus.devices.length, 1);

    const revoked = await request("/api/v1/devices/revoke", {
      device_id: deviceId,
    }, secondToken);
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.data.signed_out_current_device, true);
    const revokedStatus = await fetch(`${base}/api/v1/license/status`, {
      headers: { Authorization: `Bearer ${secondToken}` },
    });
    assert.equal(revokedStatus.status, 401);

    const root = await fetch(`${base}/`);
    assert.equal(root.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
