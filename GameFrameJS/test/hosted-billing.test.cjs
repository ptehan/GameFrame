const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Database = require('better-sqlite3');
const Stripe = require('stripe');
const { initialize } = require('../hosted/store');
const { installBilling } = require('../hosted/billing');

test('signed billing events use current paid Stripe state; duplicates and old events cannot regress access', async () => {
  const db = new Database(':memory:'); initialize(db);
  db.prepare("INSERT INTO hosted_billing(account_id,customer_id) VALUES('account','cus_test')").run();
  let paid = true, end = Math.floor(Date.now() / 1000) + 86400;
  const actual = new Stripe('sk_test_fake');
  const stripe = { webhooks: actual.webhooks, subscriptions: { retrieve: async () => ({ id: 'sub_test', customer: 'cus_test', status: paid ? 'active' : 'past_due',
    items: { data: [{ price: { id: 'price_test' }, current_period_start: 100, current_period_end: end }] },
    latest_invoice: { status: paid ? 'paid' : 'open', lines: { data: [{ price: { id: 'price_test' }, period: { start: 100, end } }] } } }) } };
  const app = express(), secret = 'whsec_test';
  installBilling(app, { db, stripe, origin: 'https://test.invalid', priceId: 'price_test', webhookSecret: secret,
    requireSession: (req, res, next) => next(), csrf: (req, res, next) => next(), salesOpen: () => false });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  async function event(id, signature = true) {
    const payload = JSON.stringify({ id, type: 'customer.subscription.updated', data: { object: { id: 'sub_test' } } });
    return fetch(origin + '/api/billing/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json',
      'Stripe-Signature': signature ? actual.webhooks.generateTestHeaderString({ payload, secret }) : 'invalid' }, body: payload });
  }
  try {
    assert.equal((await event('evt_bad', false)).status, 400);
    assert.equal((await event('evt_1')).status, 200);
    assert.equal(db.prepare('SELECT paid_until FROM hosted_billing').get().paid_until, end);
    assert.equal((await event('evt_1')).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM hosted_events').get().n, 1);
    paid = false; end += 86400;
    assert.equal((await event('evt_failed')).status, 200);
    assert.equal(db.prepare('SELECT paid_until FROM hosted_billing').get().paid_until, end - 86400);
    paid = true; await event('evt_renewal');
    // An older notification still retrieves the latest subscription.
    await event('evt_old'); assert.equal(db.prepare('SELECT paid_until FROM hosted_billing').get().paid_until, end);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

test('Checkout reuses pending sessions, does not grant access, and rejects duplicate subscriptions', async () => {
  const db = new Database(':memory:'); initialize(db);
  let created = 0, customerCreates = 0, active = false;
  const stripe = { customers: { create: async () => { customerCreates++; return { id: 'cus_checkout' }; } },
    subscriptions: { list: async () => ({ data: active ? [{ status: 'active' }] : [] }) },
    prices: { retrieve: async () => ({ unit_amount: 900, currency: 'usd', recurring: { interval: 'month', interval_count: 1 } }) },
    checkout: { sessions: { create: async (payload, options) => {
      created++; assert.equal(payload.line_items[0].price, 'price_founder'); assert.match(options.idempotencyKey, /^checkout:/);
      return { id: 'cs_test', url: 'https://checkout.stripe.com/test' };
    }, retrieve: async () => ({ id: 'cs_test', status: 'open', url: 'https://checkout.stripe.com/test' }) } },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/test' }) } } };
  const app = express();
  installBilling(app, { db, stripe, origin: 'https://app.test.invalid', priceId: 'price_founder', salesOpen: () => true,
    requireSession: (req, res, next) => { req.account = { account_id: 'account', email: 'test@example.invalid' }; next(); },
    csrf: (req, res, next) => next() });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/billing/checkout`;
  try {
    for (let n = 0; n < 2; n++) assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200);
    assert.equal(customerCreates, 1); assert.equal(created, 1);
    assert.equal(db.prepare('SELECT paid_until FROM hosted_billing').get().paid_until, 0);
    active = true;
    assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 409);
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});
