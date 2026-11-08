const test = require('node:test');
const assert = require('node:assert/strict');
const {measurePitch,savedPitchSpeed} = require('../pitch-speed');

test('export closing formula uses flight distance, source FPS and elapsed frames',()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const {buildPitchSpeedExport}=require('../pitch-speed-export');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gf_formula_test_'));
  try {
    const speed=measurePitch({fps:60,contact_frame:119},{release_frame:90.5,mound_distance:60.5,extension:3.5,contact_adjustment:3});
    buildPitchSpeedExport({dir,blob:Buffer.alloc(0),speed,name:'Test',logo:'logo.png',font:'',run:()=>{
      fs.writeFileSync(path.join(dir,'pitch-speed.mp4'),Buffer.alloc(0));
    }});
    const labels=fs.readdirSync(dir).filter(name=>name.startsWith('text-')).map(name=>fs.readFileSync(path.join(dir,name),'utf8'));
    assert.ok(labels.includes('3600 x 54 x 60 / 28.5 / 5280 = 77.5 mph average'));
    assert.ok(labels.includes('Out of the hand = average x 1.05 (assumed 5% correction)'));
    assert.equal(speed.mph.toFixed(1),'81.4');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('saved pitch measurements use authoritative source timing and recomputed speeds',()=>{
  const row = {fps:59.99880002,contact_frame:119};
  const input = {release_frame:90.5,mound_distance:60.5,extension:6,contact_adjustment:3,initial_mph:999};
  const speed = measurePitch(row,input);
  assert.equal(speed.fps,60);
  assert.equal(speed.frames,28.5);
  assert.equal(speed.mph,1.05*3600*51.5*60/28.5/5280);
  assert.deepEqual(savedPitchSpeed({...row,...input,release_extension:6}),speed);
  assert.equal(savedPitchSpeed(row),null);
  for (const release_frame of [null,'',-1,119,90.2]) assert.throws(()=>measurePitch(row,{...input,release_frame}));
  assert.throws(()=>measurePitch(row,{...input,extension:-1}));
  assert.throws(()=>measurePitch(row,{...input,mound_distance:10,extension:6,contact_adjustment:5}));
  assert.throws(()=>measurePitch({...row,contact_frame:null},input));
});
