const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const source = fs.readFileSync(path.join(__dirname, '../matchup-renderer.js'), 'utf8');
const functions = source.slice(source.indexOf('    function framesToCloneSeconds('), source.indexOf('    function pushSegment('));
const sideChain = vm.runInNewContext(`${functions}\nsideChain`, {commonFps:60,HALF_W:16,OUTPUT_H:16,pitchSpeed:null,swingEv:null});

test('portrait pitch keeps its top and bottom edges in the matchup panel', () => {
  const filter = sideChain(0, 1, 0, 1, 1, null, 'framed', false, true);
  const result = spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i',
    'color=black:s=32x64:r=60,drawbox=x=0:y=0:w=iw:h=16:color=white:t=fill,drawbox=x=0:y=48:w=iw:h=16:color=white:t=fill',
    '-filter_complex',filter,'-map','[framed]','-pix_fmt','gray','-f','rawvideo','pipe:1'],
    {maxBuffer:1024*1024,timeout:30000,windowsHide:true});
  assert.equal(result.status,0,result.stderr?.toString());
  assert.equal(result.stdout.length,256);
  assert.ok(result.stdout[8] > 230, 'top edge must remain visible');
  assert.ok(result.stdout[15*16+8] > 230, 'bottom edge must remain visible');
  assert.ok(result.stdout[8*16] < 20, 'unused panel width should be padded');
});

for (const rate of [30,60]) {
  test(`single ${rate} FPS source frame survives conversion to a 60-frame freeze`, () => {
    const filter = sideChain(0,9,8,9,60,null,'frozen',false,true);
    const result = spawnSync(require('ffmpeg-static'), ['-v','error','-f','lavfi','-i',
      `color=white:s=32x32:r=${rate}`, '-filter_complex',filter,'-map','[frozen]',
      '-pix_fmt','gray','-f','rawvideo','pipe:1'], {maxBuffer:1024*1024,timeout:30000,windowsHide:true});
    assert.equal(result.status,0,result.stderr?.toString());
    assert.equal(result.stdout.length,60*16*16);
    assert.ok(result.stdout.every(value => value>240));
  });
}

test('velocity footer stays below the picture on the correct side', () => {
  const withSpeeds = vm.runInNewContext(`${functions}\nsideChain`, {
    commonFps:60,HALF_W:640,OUTPUT_H:720,pitchSpeed:{mph:82.5},swingEv:87,drawtextBase:''
  });
  const pitch = withSpeeds(0,9,8,9,1,null,'pitch',false,true);
  const swing = withSpeeds(1,9,8,9,1,null,'swing',false,true);
  assert.match(pitch,/pad=640:642/);
  assert.match(pitch,/Pitch speed/);
  assert.match(pitch,/82.5 mph/);
  assert.match(swing,/Exit velocity/);
  assert.match(swing,/87.0 mph/);
  assert.doesNotMatch(swing,/82.5 mph/);
});

test('matchup title uses aligned plain speed lines without stat boxes or explanatory copy', () => {
  const titleSource = source.slice(source.indexOf('    function titleCardFilter('), source.indexOf('    const titleFilters = ['));
  const makeTitle = speeds => vm.runInNewContext(`${titleSource}\ntitleCardFilter`, {
    ...speeds, pitcherName:'Pitcher',hitterName:'Hitter',drawtextBase:'',commonFps:60,TITLE_SECONDS:4,
    swingDurationText:'0.70s',decisionToContactText:'0.20s',wrapTitleLines:name=>[name],ffmpegDrawtextEscape:text=>text
  })('input','logo','title','MATCHUP');
  const graph = makeTitle({pitchSpeed:{mph:83.5,average:79.5},swingEv:76});
  assert.match(graph,/Pitch speed 83.5 mph/);
  assert.match(graph,/Exit velocity 76.0 mph/);
  assert.match(graph,/x=320-text_w\/2:y=398/);
  assert.match(graph,/x=960-text_w\/2:y=398/);
  assert.doesNotMatch(graph,/average|estimated|aligned at contact|w=248|t=2,/);
  const unknown = makeTitle({pitchSpeed:null,swingEv:null});
  assert.doesNotMatch(unknown,/mph/);
});
