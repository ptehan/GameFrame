const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-unified-test-'));
process.env.DB_PATH = path.join(directory, 'test.db');
const { startServer, closeDatabase } = require('../server');
(async () => {
  const server = startServer(0, '127.0.0.1');
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const db = new Database(process.env.DB_PATH);
  const post = async (url, body) => {
    const response = await fetch(origin + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.ok(response.ok, await response.clone().text());
    return response.json();
  };
  try {
    const options = await (await fetch(origin + '/api/gameframe/options')).json();
    assert.deepEqual(options.hitters, []);
    const team = (await post('/api/gameframe/team', { name: 'Unified test team' })).team;
    const hitter = (await post('/api/gameframe/hitter', { name: 'Unified Player', team_id: team.id })).hitter;
    const clip = path.join(directory, 'test.mp4');
    const encode = spawnSync(require('ffmpeg-static'), ['-y','-v','error','-f','lavfi','-i','color=c=green:s=320x240:r=30','-t','1','-c:v','libx264',clip], {windowsHide:true});
    assert.equal(encode.status, 0, encode.stderr?.toString());
    const blob = fs.readFileSync(clip);
    const id = Number(db.prepare(`INSERT INTO ev_hit_tracks(team_id,hitter_id,source_file_name,generated_clip_blob,generated_clip_mime_type,observation_package_json,prediction_json)
      VALUES(?,?,'test.mp4',?,'video/mp4','{}','{}')`).run(team.id,hitter.id,blob).lastInsertRowid);
    const saved = await (await fetch(origin + '/api/gameframe/ev-hit?id=' + id)).json();
    assert.ok(saved);
    const stream = await fetch(origin + '/api/gameframe/ev-clip?id=' + id + '&kind=generated&inline=1');
    assert.equal(stream.status, 200);
    assert.deepEqual(Buffer.from(await stream.arrayBuffer()), blob);
    assert.equal((await fetch(origin + '/api/gameframe/does-not-exist')).status, 404);
    const job = await post('/api/clip', { file_name: 'missing-unified-test.mp4', contact_time_s: 1 });
    const status = await (await fetch(origin + '/api/clip/status?id=' + job.job_id)).json();
    assert.equal(status.status, 'error');
    const renderJob = await post('/api/clip', {
      source_path: clip, file_name: 'test.mp4', contact_time_s: 0.5, pre_s: 0.5, post_s: 0.5,
      banner_text: 'EV 88 mph|LA 22 degrees|Distance 326 feet',
      package: { video_metadata: { file_name: 'test.mp4', source_path: clip },
        hit: { gameframe_hitter_id: hitter.id, contact: { timestamp_s: 0.5 } } },
    });
    let rendered;
    for (let attempt = 0; attempt < 90; attempt++) {
      rendered = await (await fetch(origin + '/api/clip/status?id=' + renderJob.job_id)).json();
      if (['done', 'error'].includes(rendered.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(rendered.status, 'done', JSON.stringify(rendered));
    assert.equal(rendered.player_name, 'Unified Player');
    const download = await fetch(origin + rendered.download_url);
    assert.equal(download.status, 200);
    assert.match(Buffer.from(await download.arrayBuffer()).subarray(0,32).toString(), /ftyp/);
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.locator('#open-ev-modeling').click();
    await page.locator('#ev-menu-video').setInputFiles(clip);
    const frame = page.frameLocator('#menu-flow-frame');
    await frame.locator('#open-ev-library').waitFor({state:'attached'});
    await page.waitForFunction(() => {
      const win = document.getElementById('menu-flow-frame').contentWindow;
      return win.location.pathname === '/ev/predictor.html' && win.document.querySelector('video')?.readyState >= 1;
    });
    assert.equal(await frame.locator('body').evaluate(() => location.origin), origin);
    await frame.locator('#open-actual-field-map').evaluate(button => button.click());
    await frame.locator('#actual-field-map-modal[open]').waitFor();
    await frame.locator('.leaflet-tile-loaded').first().waitFor({ state: 'attached' });
    assert.ok(await frame.locator('.leaflet-tile-loaded').first().evaluate(img => img.naturalWidth > 0));
    await frame.locator('body').evaluate(() => closeActualFieldMapModal());
    // Exercise the same-origin handoff used by the EV Library button.
    await frame.locator('#open-ev-library').evaluate(button => button.click());
    await page.waitForFunction(() => document.getElementById('menu-flow-frame').contentWindow.location.pathname === '/library');
    assert.equal(await page.locator('#menu-flow-modal').evaluate(d => d.open), true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('PASS: one origin handles EV assets, shared database, JSON APIs, binary video, async jobs, video upload and library handoff.');
  } finally {
    await browser.close(); db.close();
    await new Promise(resolve => server.close(resolve)); closeDatabase();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
