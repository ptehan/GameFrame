const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../ev-predictor/app.js'), 'utf8');
function extract(name) {
  const marker = `function ${name}(`;
  const index = source.indexOf(marker);
  assert.ok(index >= 0, name);
  const start = source.slice(index - 6, index) === 'async ' ? index - 6 : index;
  let depth = 0;
  for (let i = source.indexOf('{', index); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Missing function end: ${name}`);
}
const hits = [
  { progress: 20, evidence: 20 }, null,
  { progress: 10, evidence: 100 }, { progress: 120, evidence: 100 },
  { progress: 50, evidence: 1 }, { progress: 60, evidence: 20 },
  null, { progress: 80, evidence: 20 }, { progress: 120, evidence: 100 },
];
const captured = [];
const context = vm.createContext({
  state: { frameStepS: 1 / 30, contactTime: 2 },
  els: { autoTrackStatus: {}, showAutoTrack: {} },
  nextPaint: async () => {},
  captureDetectionFrame: async (t) => { captured.push(t); return { scale: 1, width: 1000, height: 1000 }; },
  visibleBallResponseFrame: () => ({}),
  farthestLineStreak: () => hits.shift(),
  confidenceFromEvidence: () => ({ confidence: 'MEDIUM', uncertainty_px: 24 }),
  round: (n, digits) => Number(n.toFixed(digits)),
  renderOverlay: () => {}, updateAutoTrackStatus: () => {},
});
for (const name of ['currentStep', 'ballAnchorFrameGap', 'supportedForwardProgress', 'lineExitProgressPixels', 'detectFlightWithManualLineFastPath']) {
  vm.runInContext(extract(name), context);
}
(async () => {
  for (const [fps, expected] of [[30,10],[60,20],[59.94,20],[120,20]]) {
    context.state.frameStepS = 1 / fps;
    assert.equal(context.ballAnchorFrameGap(), expected);
  }
  context.state.frameStepS = 1 / 30;
  assert.equal(context.supportedForwardProgress(20, 30, 100, 99), null);
  assert.equal(context.supportedForwardProgress(40, 30, 100, 0), null);
  assert.equal(context.supportedForwardProgress(120, 30, 100, 99), null);
  await context.detectFlightWithManualLineFastPath({
    contactPoint: { image_x: 100, image_y: 100 },
    fiveFramePoint: { image_x: 200, image_y: 100, relative_time_s: 10 / 30 },
  });
  const rows = JSON.parse(JSON.stringify(context.state.autoObservations));
  assert.deepEqual(rows.map(r => r.image_x), [120,160,180,200]);
  assert.deepEqual(rows.map(r => Math.round(r.relative_time_s * 30)), [1,6,8,10]);
  assert.equal(captured.length,11);
  assert.ok(Math.abs(captured.at(-1)-(2+10/30))<1e-9);
  assert.ok(rows.every(r => r.confidence === 'HIGH'));
  assert.ok(rows.slice(0, -1).every(r => r.note.includes('high confidence assumed from manual endpoint guidance')));
  assert.match(context.els.autoTrackStatus.textContent, /6 frames left untracked/);
  console.log('PASS: 30/60/120 fps windows; full fast path rejects weak, missing, backward and overshooting detections without filling gaps.');
})().catch(error => { console.error(error); process.exitCode = 1; });
