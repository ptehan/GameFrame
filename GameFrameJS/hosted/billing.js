const express = require('express');
const crypto = require('node:crypto');

function installBilling(app, { db, stripe, origin, priceId, webhookSecret, requireSession, csrf, salesOpen }) {
  async function synchronize(subscriptionId) {
    // Always fetch current Stripe state: an old event must not roll back a renewal.
    const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['latest_invoice'] });
    const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const row = db.prepare('SELECT * FROM hosted_billing WHERE customer_id=?').get(customer);
    if (!row) return;
    if (Number(sub.created || 0) < row.subscription_created) return;
    const item = sub.items.data.find(item => item.price.id === priceId);
    if (!item) throw new Error('Unexpected subscription price');
    const invoice = sub.latest_invoice;
    const line = invoice && typeof invoice === 'object' && invoice.lines?.data.find(line =>
      (line.pricing?.price_details?.price || line.price?.id) === priceId);
    const period = line?.period || { start: item.current_period_start || sub.current_period_start,
      end: item.current_period_end || sub.current_period_end };
    // Only a paid invoice extends access. A past_due renewal cannot grant time.
    const paid = invoice && typeof invoice === 'object' && invoice.status === 'paid' && Number.isFinite(period.end);
    db.prepare(`UPDATE hosted_billing SET subscription_id=?,status=?,subscription_created=?,
      period_start=CASE WHEN ? AND ?>=paid_until THEN ? ELSE period_start END,
      paid_until=CASE WHEN ? THEN MAX(paid_until,?) ELSE paid_until END,updated_at=? WHERE account_id=?`)
      .run(sub.id, sub.status, sub.created || 0, Number(Boolean(paid)), period.end || 0, period.start || 0, Number(Boolean(paid)), period.end || 0,
        new Date().toISOString(), row.account_id);
  }
  // Must be installed before JSON parsing so signature verification sees exact bytes.
  app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!stripe || !webhookSecret) return res.sendStatus(503);
    let event;
    try { event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret); }
    catch (_) { return res.sendStatus(400); }
    try {
      if (db.prepare('SELECT id FROM hosted_events WHERE id=?').get(event.id)) return res.json({ received: true });
      const object = event.data.object;
      let subscription = event.type.startsWith('customer.subscription.') ? object.id :
        object.subscription || object.parent?.subscription_details?.subscription;
      if (subscription && typeof subscription === 'object') subscription = subscription.id;
      if (subscription) await synchronize(subscription);
      db.prepare('INSERT OR IGNORE INTO hosted_events VALUES(?,?)').run(event.id, new Date().toISOString());
      res.json({ received: true });
    } catch (error) { console.error('Billing webhook failed:', error.message); res.sendStatus(503); }
  });
  app.post('/api/billing/checkout', express.json(), requireSession, csrf, async (req, res, next) => {
    try {
      if (!stripe || !priceId || !salesOpen()) return res.status(503).json({ error: 'Paid registration is not open.' });
      const account = req.account;
      // Stable Stripe idempotency keys prevent duplicate customers and checkouts.
      let billing = db.prepare('SELECT * FROM hosted_billing WHERE account_id=?').get(account.account_id);
      if (!billing?.customer_id) {
        const customer = await stripe.customers.create({ email: account.email, metadata: { account_id: account.account_id } },
          { idempotencyKey: `customer:${account.account_id}` });
        db.prepare(`INSERT INTO hosted_billing(account_id,customer_id) VALUES(?,?)
          ON CONFLICT(account_id) DO UPDATE SET customer_id=excluded.customer_id`).run(account.account_id, customer.id);
        billing = db.prepare('SELECT * FROM hosted_billing WHERE account_id=?').get(account.account_id);
      }
      const active = await stripe.subscriptions.list({ customer: billing.customer_id, status: 'all', limit: 100 });
      if (active.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) {
        return res.status(409).json({ error: 'Manage your existing subscription through billing settings.' });
      }
      const price = await stripe.prices.retrieve(priceId);
      if (price.unit_amount !== 900 || price.currency !== 'usd' || price.recurring?.interval !== 'month' || price.recurring?.interval_count !== 1) {
        throw new Error('Stripe price must be USD 9 per month');
      }
      const previous = db.prepare('SELECT * FROM hosted_checkout WHERE account_id=?').get(account.account_id);
      if (previous?.session_id) {
        const session = await stripe.checkout.sessions.retrieve(previous.session_id);
        if (session.status === 'open') return res.json({ url: session.url });
      }
      const requestKey = db.transaction(() => {
        const current = db.prepare('SELECT * FROM hosted_checkout WHERE account_id=?').get(account.account_id);
        if (!current) db.prepare('INSERT INTO hosted_checkout VALUES(?,?,NULL)').run(account.account_id, crypto.randomUUID());
        else if (previous?.session_id && current.session_id === previous.session_id) {
          db.prepare('UPDATE hosted_checkout SET request_key=?,session_id=NULL WHERE account_id=?').run(crypto.randomUUID(), account.account_id);
        }
        return db.prepare('SELECT request_key FROM hosted_checkout WHERE account_id=?').get(account.account_id).request_key;
      }).immediate();
      const session = await stripe.checkout.sessions.create({ customer: billing.customer_id, mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }], client_reference_id: account.account_id,
        success_url: `${origin}/account?checkout=returned`, cancel_url: `${origin}/account`,
        subscription_data: { metadata: { account_id: account.account_id } } },
      { idempotencyKey: `checkout:${requestKey}` });
      db.prepare('UPDATE hosted_checkout SET session_id=? WHERE account_id=? AND request_key=?').run(session.id, account.account_id, requestKey);
      res.json({ url: session.url });
    } catch (error) { next(error); }
  });
  app.post('/api/billing/portal', express.json(), requireSession, csrf, async (req, res, next) => {
    try {
      const billing = db.prepare('SELECT customer_id FROM hosted_billing WHERE account_id=?').get(req.account.account_id);
      if (!stripe || !billing?.customer_id) return res.status(409).json({ error: 'No billing account yet.' });
      const session = await stripe.billingPortal.sessions.create({ customer: billing.customer_id, return_url: `${origin}/account` });
      res.json({ url: session.url });
    } catch (error) { next(error); }
  });
  return { synchronize, async reconcile() {
    if (!stripe) return;
    for (const row of db.prepare('SELECT subscription_id FROM hosted_billing WHERE subscription_id IS NOT NULL').all()) await synchronize(row.subscription_id);
  } };
}
module.exports = { installBilling };
