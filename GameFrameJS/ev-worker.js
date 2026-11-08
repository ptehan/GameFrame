const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

function createEvWorker({ root, databasePath, spawnProcess = spawn }) {
  const processorRoot = root.replace(/app\.asar(?=[\\/]|$)/, 'app.asar.unpacked');
  let child = null;
  const pending = new Map();
  async function cleanResponse(directory) {
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('gameframe-ev-')) {
      throw new Error('Unexpected EV response directory');
    }
    await fsp.rm(directory, { recursive: true, force: true });
  }
  function stop() {
    const processToStop = child;
    child = null;
    if (processToStop?.pid) {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(processToStop.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        try { process.kill(-processToStop.pid, 'SIGTERM'); } catch (_) { processToStop.kill(); }
      }
    }
    for (const request of pending.values()) request.reject(new Error('EV processing stopped. Please retry.'));
    pending.clear();
  }
  function start() {
    if (child) return child;
    const localPython = path.join(root, '.venv-ev', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const python = process.env.GAMEFRAME_EV_PYTHON || (fs.existsSync(localPython) ? localPython : process.env.PYTHON || 'python');
    const worker = spawnProcess(python, ['-u', path.join(processorRoot, 'ev-predictor', 'worker.py')], {
      cwd: path.join(processorRoot, 'ev-predictor'),
      env: { ...process.env, DB_PATH: databasePath, PYTHONIOENCODING: 'utf-8',
        FFMPEG_PATH: process.env.FFMPEG_PATH || require('ffmpeg-static').replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked'),
        FFPROBE_PATH: process.env.FFPROBE_PATH || require('ffprobe-static').path.replace(/app\.asar(?=[\\/]|$)/,'app.asar.unpacked') },
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = worker;
    const fail = error => {
      if (child !== worker) return;
      child = null;
      for (const request of pending.values()) request.reject(error);
      pending.clear();
    };
    worker.on('error', fail);
    worker.on('exit', () => fail(new Error('EV processor exited. Please retry.')));
    worker.stdin.on('error', fail);
    worker.stderr.on('data', chunk => process.stderr.write(chunk));
    readline.createInterface({ input: worker.stdout }).on('line', line => {
      let result;
      try { result = JSON.parse(line); } catch (_) { return; }
      const request = pending.get(result.id);
      if (!request) return;
      pending.delete(result.id);
      if (result.error) request.reject(new Error(result.error));
      else request.resolve(result);
    });
    return worker;
  }
  async function handle(req, res, next) {
    let directory;
    try {
      directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'gameframe-ev-'));
      const output = path.join(directory, 'response');
      const worker = start();
      const id = crypto.randomUUID();
      const cancel = () => {
        if (res.writableEnded || req.originalUrl.split('?')[0] !== '/api/predict' || !pending.has(id)) return;
        worker.stdin.write(JSON.stringify({id, method:'CANCEL'})+'\n', () => {});
      };
      res.once('close', cancel);
      const result = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => stop(), 10 * 60 * 1000);
        timeout.unref();
        pending.set(id, {
          resolve: value => { clearTimeout(timeout); resolve(value); },
          reject: error => { clearTimeout(timeout); reject(error); },
        });
        worker.stdin.write(JSON.stringify({ id, method: req.method, path: req.originalUrl, body: req.body, output }) + '\n', error => {
          if (error) { pending.delete(id); clearTimeout(timeout); reject(error); }
        });
        if (res.destroyed) cancel();
      });
      res.removeListener('close', cancel);
      if (res.destroyed) { await cleanResponse(directory); return; }
      res.status(result.status).set(result.headers);
      res.sendFile(output, error => {
        cleanResponse(directory).catch(() => {});
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      if (directory) await cleanResponse(directory).catch(() => {});
      next(error);
    }
  }
  process.once('exit', stop);
  return { handle, stop, warm: start };
}

module.exports = { createEvWorker };
