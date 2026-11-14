const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function hash(file) { const digest = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
async function provision() {
  const file = process.env.GAMEFRAME_SYNTHETIC_DB, expected = process.env.GAMEFRAME_SYNTHETIC_SHA256;
  if (!file || !/^[a-f0-9]{64}$/.test(expected || '')) throw new Error('Configure the private flight database path and SHA-256');
  if (fs.existsSync(file)) { if (await hash(file) !== expected) throw new Error('Flight database checksum mismatch'); return; }
  const url = process.env.GAMEFRAME_SYNTHETIC_URL;
  if (!url || new URL(url).protocol !== 'https:') throw new Error('Provide an HTTPS flight database download URL');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const partial = `${file}.${crypto.randomUUID()}.partial`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Private flight database download failed');
    let bytes = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, encoding, callback) {
      bytes += chunk.length; callback(bytes > 2 * 1024 ** 3 ? new Error('Flight database exceeds size limit') : null, chunk);
    } }), fs.createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    if (await hash(partial) !== expected) throw new Error('Downloaded flight database checksum mismatch');
    fs.renameSync(partial, file);
  } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); }
}
if (require.main === module) provision().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { provision, hash };
