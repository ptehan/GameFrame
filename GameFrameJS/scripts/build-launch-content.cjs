const fs = require('node:fs');
const path = require('node:path');
const content = require('../release/content.json');
const destination = path.resolve(process.argv[2] || 'release-artifacts/launch');
fs.mkdirSync(destination, { recursive: true });
const values = { SITE_ORIGIN: process.env.SITE_ORIGIN || 'https://example.invalid', APP_ORIGIN: process.env.APP_ORIGIN || 'https://app.example.invalid',
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || 'SUPPORT_EMAIL_REQUIRED', BACKUP_PROVIDER: process.env.BACKUP_PROVIDER || 'BACKUP_PROVIDER_REQUIRED' };
const replace = value => String(value).replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => values[key] || key);
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cdata = value => `<![CDATA[${String(value).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
const items = [...content.pages.map(p => ({ ...p, type: 'page' })), ...content.posts.map(p => ({ ...p, type: 'post' }))];
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>GameFrame</title><link>${escape(values.SITE_ORIGIN)}</link><description>GameFrame release drafts</description><language>en-US</language><wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>${escape(values.SITE_ORIGIN)}</wp:base_site_url><wp:base_blog_url>${escape(values.SITE_ORIGIN)}</wp:base_blog_url>
<wp:author><wp:author_id>1</wp:author_id><wp:author_login>gameframe</wp:author_login><wp:author_display_name>GameFrame</wp:author_display_name></wp:author>
${items.map((item, n) => `<item><title>${escape(item.title)}</title><dc:creator>gameframe</dc:creator><content:encoded>${cdata(replace(item.body))}</content:encoded><wp:post_id>${n + 1}</wp:post_id><wp:post_name>${item.slug}</wp:post_name><wp:status>draft</wp:status><wp:post_type>${item.type}</wp:post_type><wp:comment_status>closed</wp:comment_status><wp:ping_status>closed</wp:ping_status></item>`).join('\n')}
</channel></rss>`;
fs.writeFileSync(path.join(destination, 'wordpress-drafts.xml'), xml);
fs.writeFileSync(path.join(destination, 'channel-kit.json'), replace(JSON.stringify(content.channels, null, 2)));
for (const item of items) fs.writeFileSync(path.join(destination, `${item.slug}.html`), `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(item.title)}</title><body>${replace(item.body)}</body></html>`);
const schedule = require('../release/schedule.json');
const calendarEscape = value => String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
const date = value => value.replaceAll('-', '');
const events = schedule.milestones.map((item, n) => {
  const end = new Date(item.end + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 1);
  return ['BEGIN:VEVENT', `UID:gameframe-release-2026-${n}@gameframe.local`, 'DTSTAMP:20261113T170000Z',
    `DTSTART;VALUE=DATE:${date(item.start)}`, `DTEND;VALUE=DATE:${date(end.toISOString().slice(0, 10))}`,
    `SUMMARY:${calendarEscape(item.title)}`, `DESCRIPTION:${calendarEscape(`Owner: ${item.owner}\nStatus: ${item.status}\nPatrick: ${item.user_action}`)}`, 'END:VEVENT'].join('\r\n');
});
fs.writeFileSync(path.join(destination, 'launch-calendar.ics'), ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//GameFrame//Hosted beta release//EN',
  'CALSCALE:GREGORIAN', 'X-WR-TIMEZONE:America/New_York', ...events, 'END:VCALENDAR', ''].join('\r\n'));
console.log(`Prepared ${items.length} WordPress drafts and channel copy in ${destination}. No content was published.`);
