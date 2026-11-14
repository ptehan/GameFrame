function escape(value) { return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
function installLegal(app) {
  app.get(['/privacy', '/terms'], (req, res) => {
    if (process.env.SITE_ORIGIN && process.env.GAMEFRAME_LEGAL_PUBLISHED === 'true') {
      const site = new URL(process.env.SITE_ORIGIN);
      if (site.protocol !== 'https:' || site.origin !== process.env.SITE_ORIGIN) return res.status(503).send('Public site configuration needs review.');
      return res.redirect(302, new URL(req.path, site).href);
    }
    const privacy = req.path === '/privacy';
    const content = privacy
      ? '<p>This is the hosted GameFrame beta. Uploaded videos, player records, marks and results are processed and stored on the server in private account workspaces.</p><p>Render hosts processing and storage. Resend delivers account email. Stripe handles billing through its hosted pages. Off-service backups require a separately configured provider. Field-map address searches use OpenStreetMap Nominatim and aerial tiles use Esri ArcGIS; those services receive the map searches and locations your browser requests.</p><p>After trial or paid access expires, processing stops and saved footage remains available for download for 30 days. Deletion notices precede automatic footage removal. An explicit account-deletion request disables sign-in and schedules removal after 30 days. Backups may retain deleted footage during their seven-day retention window; payment and account operational records may remain.</p>'
      : '<p>GameFrame is a baseball video-study tool. Estimates depend on video quality, frame timing, calibration, marked evidence and the flight model. They are not guarantees of performance.</p><p>Use footage only when you have the necessary permission. Protect your sign-in codes and do not attempt to access another account or bypass limits.</p><p>The founding subscription is USD 9 per month and renews until canceled. It includes 30 monthly processing credits and 1 GB of workspace storage. One completed EV matching run or matchup render uses one credit. Successful reruns count; system failures return reserved credits. Credits do not roll over. Manage payment and cancellation through Account. Cancellation retains access through the paid period.</p>';
    const contact = process.env.SUPPORT_EMAIL ? `Contact ${escape(process.env.SUPPORT_EMAIL)} for support, privacy or billing questions.` : 'Contact the beta administrator for support, privacy or billing questions.';
    res.type('html').send(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${privacy ? 'Privacy' : 'Terms'} · GameFrame</title><body style="font:18px system-ui;max-width:760px;padding:24px;margin:auto;line-height:1.6"><h1>GameFrame ${privacy ? 'privacy and data' : 'beta terms'}</h1>${content}<p>${contact}</p><p>Pre-release technical disclosure: final public wording requires owner review before paid registration opens.</p><a href="/auth/login">Sign in</a></body></html>`);
  });
}
module.exports = { installLegal };
