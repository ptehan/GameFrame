const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const helpers = source.slice(source.indexOf('function parsePortraitCrop('), source.indexOf('function buildSummary('));
const { parsePortraitCrop, buildTrimFilter } = vm.runInNewContext(`${helpers}\n({parsePortraitCrop,buildTrimFilter})`);

test('crop retains the window width instead of imposing a different aspect ratio', () => {
  const crop = parsePortraitCrop(JSON.stringify({enabled:true,x:0.1,y:0.1,w:0.8,h:0.8}), true);
  assert.equal(crop.w, 0.8);
  assert.equal(crop.h, 0.8);
  assert.equal(crop.x, 0.1);
  assert.equal(crop.y, 0.1);
});

test('encoded crop retains both visible edges and the window aspect ratio', () => {
  const crop = parsePortraitCrop({enabled:true,x:0.1,y:0.1,w:0.8,h:0.8}, true);
  const filter = buildTrimFilter({start:0,endFrame:0,crop});
  const encoded = spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i',
    'color=red:s=400x200:r=30:d=0.1,drawbox=x=300:y=0:w=100:h=200:color=blue:t=fill',
    '-vf',filter,'-c:v','libx264','-pix_fmt','yuv420p','-f','matroska','pipe:1'], {maxBuffer:5*1024*1024,windowsHide:true});
  assert.equal(encoded.status,0,encoded.stderr?.toString());
  const decoded = spawnSync(require('ffmpeg-static'), ['-v','error','-i','pipe:0','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],
    {input:encoded.stdout,maxBuffer:5*1024*1024,windowsHide:true});
  assert.equal(decoded.status,0,decoded.stderr?.toString());
  assert.equal(decoded.stdout.length,720*360*3);
  const left = (180*720+10)*3;
  const right = (180*720+710)*3;
  assert.ok(decoded.stdout[left]>200 && decoded.stdout[left+2]<30,'Left red edge was cropped out');
  assert.ok(decoded.stdout[right]<30 && decoded.stdout[right+2]>200,'Right blue edge was cropped out');
});
