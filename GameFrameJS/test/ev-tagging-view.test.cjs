const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../ev-predictor/app.js'), 'utf8');

function fixture(width = 800, height = 450) {
  const rect = {left: 30, top: 40, width, height};
  const controls = new Map();
  const context = vm.createContext({
    els: {
      overlay: {style: {}, getBoundingClientRect: () => rect},
      video: {videoWidth: 1280, videoHeight: 720, clientWidth:width, clientHeight:height,
        style: {}, getBoundingClientRect: () => ({width: width * 4, height: height * 4})},
    },
    document: {getElementById(id) { if (!controls.has(id)) controls.set(id, {}); return controls.get(id); }},
    renderOverlay() {},
    window: {devicePixelRatio: 1}, ctx: {setTransform() {}},
  });
  vm.runInContext(app.slice(app.indexOf('function syncCanvasSize()'), app.indexOf('function visibleObservationsFromCurrentTimeOnward(')) +
    '\nglobalThis.view = groundView;', context);
  return {context, rect, controls};
}

test('zoom and pan preserve source coordinates, including letterboxed video', () => {
  for (const [width, height] of [[800,450], [800,800], [1200,450]]) {
    const {context:c, rect} = fixture(width,height);
    for (const zoom of [1,2,6]) {
      Object.assign(c.view, {zoom, x:35, y:-20});
      c.updateGroundView();
      for (const [x,y] of [[0,0], [640,360], [1100,650]]) {
        const display = c.videoToDisplayPoint(x,y);
        const actual = c.displayToVideoPoint({clientX:display.x+rect.left, clientY:display.y+rect.top});
        assert.ok(Math.abs(actual.x-x)<1e-8);
        assert.ok(Math.abs(actual.y-y)<1e-8);
      }
      assert.equal(c.els.video.videoWidth,1280);
      assert.equal(c.els.video.videoHeight,720);
    }
  }
});

test('canvas sizing ignores CSS zoom so periodic resize cannot multiply the zoom', () => {
  const {context:c} = fixture();
  c.view.zoom = 4;
  for (let i=0; i<3; i++) c.syncCanvasSize();
  assert.equal(c.els.overlay.width,800);
  assert.equal(c.els.overlay.height,450);
});

test('leaving ground tagging resets viewing zoom and hides its controls', () => {
  const {context:c,controls} = fixture();
  Object.assign(c.view,{zoom:4,x:120,y:80});
  c.syncGroundView('ground');
  assert.equal(controls.get('ground-view-controls').hidden,false);
  assert.equal(c.view.zoom,4);
  c.syncGroundView('ballPath');
  assert.equal(controls.get('ground-view-controls').hidden,true);
  assert.equal(c.view.zoom,1);
  assert.equal(c.view.x,0);
  assert.equal(c.view.y,0);
});
