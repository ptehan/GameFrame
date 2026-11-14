const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'release-artifacts/footage-review');
fs.mkdirSync(path.join(destination, 'clips'), { recursive: true });
const database = new Database(path.resolve(process.argv[2] || path.join(root, 'app.db')), { readonly: true });
const escape = value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const records = [];
try {
  for (const [type, table, blob] of [['pitch','pitch_clips','clip_blob'], ['swing','swing_clips','clip_blob'], ['matchup','matchups','matchup_blob'], ['ev','ev_hit_tracks','COALESCE(generated_clip_blob,clip_blob)']]) {
    if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) continue;
    for (const row of database.prepare(`SELECT id,description,${blob} AS video FROM ${table} ORDER BY id`).all()) {
      if (!row.video?.length) continue;
      const name = `${type}-${row.id}`, file = path.join(destination, 'clips', name + '.mp4');
      fs.writeFileSync(file, row.video);
      const thumbnail = path.join(destination, 'clips', name + '.jpg');
      const result = spawnSync(require('ffmpeg-static'), ['-y','-v','error','-ss','0.5','-i',file,'-frames:v','1','-vf','scale=360:-2','-q:v','3',thumbnail], { windowsHide: true, encoding: 'utf8' });
      records.push({ name, type, id: row.id, description: row.description || 'No description', thumbnail: result.status === 0,
        permission: 'unknown; not approved for distribution',
        ...(type === 'matchup' ? database.prepare('SELECT pitch_clip_id,swing_clip_id FROM matchups WHERE id=?').get(row.id) : {}) });
    }
  }
} finally { database.close(); }
const cards = records.map(record => `<article><h2>${escape(record.type)} ${record.id}</h2><p>${escape(record.description)}</p><video controls preload="none" ${record.thumbnail ? `poster="clips/${record.name}.jpg"` : ''} src="clips/${record.name}.mp4"></video>${record.pitch_clip_id ? `<p>Uses pitch ${record.pitch_clip_id} and swing ${record.swing_clip_id}.</p>` : ''}<label>Do you recognize where this came from?<select data-clip="${record.name}"><option value="unsure">Not sure</option><option value="recorded_by_me">I recorded it</option><option value="recorded_by_someone_i_know">Someone I know recorded it</option><option value="broadcast_or_download">Broadcast / downloaded / third-party</option></select></label></article>`).join('\n');
fs.writeFileSync(path.join(destination, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GameFrame footage review</title><style>body{font:17px system-ui;background:#14231c;color:#f5f3e7;max-width:1500px;margin:auto;padding:24px}h1{font-size:36px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}article{background:#21392d;padding:18px;border-radius:12px}h2{text-transform:capitalize}video{width:100%;max-height:290px;background:#000}select,button{padding:12px;margin:10px 0;max-width:100%;font:inherit}a{color:#c8d77a}</style><h1>Which footage do you recognize?</h1><p>This is a private review of the current library, not a release library. Nothing here has been approved for app distribution or marketing. You do not need to know database IDs: watch a clip and tell me whether you recorded it or know its source.</p><p>These choices identify the source only; they do not grant permission to publish. If a source stays unclear, leave that clip out and use new footage recorded with permission.</p><button id="save">Save my source notes</button><div class="grid">${cards}</div><script>document.getElementById('save').onclick=()=>{const notes=[...document.querySelectorAll('[data-clip]')].map(select=>({clip:select.dataset.clip,source:select.value,app_distribution:'not approved',marketing:'not approved'}));const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(notes,null,2)],{type:'application/json'}));a.download='gameframe-footage-source-notes.json';a.click();URL.revokeObjectURL(a.href)};</script></html>`);
fs.writeFileSync(path.join(destination, 'inventory.json'), JSON.stringify(records, null, 2));
console.log(`Prepared ${records.length} private clip previews. The source database was opened read-only.`);
