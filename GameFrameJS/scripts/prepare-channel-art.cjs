const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.resolve('release-artifacts/browser-tools/node_modules/playwright'));
const root = path.resolve(__dirname, '..'), output = path.join(root, 'release-artifacts/launch/media');
fs.mkdirSync(output, { recursive: true });
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, 'ev-predictor/assets/gameframe-logo-video.png')).toString('base64')}`;
const header = `<image href="${logo}" x="64" y="42" width="280" height="125" preserveAspectRatio="xMinYMid meet"/>`;
for (const name of ['introduction', 'walkthrough', 'matching']) {
  const file = path.join(output, `thumbnail-${name}.svg`);
  if (!fs.existsSync(file)) continue;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/<text x="64" y="125"[^>]*>GameFrame<\/text>/, header));
}
fs.writeFileSync(path.join(output, 'youtube-banner.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="2560" height="1440"><defs><linearGradient id="b"><stop stop-color="#14231c"/><stop offset="1" stop-color="#294b37"/></linearGradient></defs><rect width="2560" height="1440" fill="url(#b)"/><image href="${logo}" x="620" y="560" width="1320" height="215"/><text x="1280" y="855" text-anchor="middle" font-family="Arial" font-size="48" fill="#c8d77a">See the timing. Study your video.</text><path d="M560 905H2000" stroke="#c8d77a" stroke-width="6"/></svg>`);
fs.writeFileSync(path.join(output, 'channel-avatar.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#14231c"/><circle cx="400" cy="400" r="328" fill="none" stroke="#c8d77a" stroke-width="13"/><text x="400" y="492" text-anchor="middle" font-family="Arial" font-weight="900" font-size="280" fill="#f7f5e9">GF</text></svg>');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [name, width, height] of [['thumbnail-introduction',1280,720], ['thumbnail-walkthrough',1280,720], ['thumbnail-matching',1280,720], ['youtube-banner',2560,1440], ['channel-avatar',800,800]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<html><body style="margin:0">${fs.readFileSync(path.join(output, name + '.svg'), 'utf8')}</body></html>`);
      await page.locator('svg').screenshot({ path: path.join(output, name + '.png') }); await page.close();
    }
  } finally { await browser.close(); }
  console.log('Prepared PNG and SVG thumbnail, banner and avatar drafts.');
})().catch(error => { console.error(error); process.exitCode = 1; });
