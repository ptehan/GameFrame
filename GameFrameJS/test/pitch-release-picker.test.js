const test = require('node:test');
const assert = require('node:assert/strict');
const {calculateManualPitch,createPitchReleasePicker} = require('../static/js/pitch-release-picker');
const preview = {selection:{start:89,end:93},contact_frame:119,timing_fps:60,settings:{pitching_feet:60.5}};

test('manual release uses fractional frames and the exact 1.05 correction', () => {
  const result = calculateManualPitch(preview,90.5,6,3);
  assert.equal(result.distance,51.5);
  assert.equal(result.frames,28.5);
  assert.equal(result.seconds,28.5/60);
  assert.equal(result.average,3600*51.5*60/28.5/5280);
  assert.equal(result.mph,result.average*1.05);
  assert.ok(result.mph > calculateManualPitch(preview,90,6,3).mph);
  assert.ok(result.mph < calculateManualPitch(preview,91,6,3).mph);
  assert.equal(calculateManualPitch({...preview,timing_fps:30},90.5,6,3).mph,result.mph/2);
});

test('manual release rejects invalid frame selections and distances', () => {
  for (const frame of [88,94,119,NaN,null]) assert.throws(() => calculateManualPitch(preview,frame,6,3));
  assert.throws(() => calculateManualPitch(preview,90,-1,3));
  assert.throws(() => calculateManualPitch(preview,90,6,NaN));
  assert.throws(() => calculateManualPitch({...preview,settings:{pitching_feet:10}},90,6,5));
  assert.throws(() => calculateManualPitch({...preview,timing_fps:0},90,6,3));
});

test('large frames and their gap select release without shifting the displayed pair', async () => {
  function element() { return {value:'',children:[],dataset:{},style:{setProperty(){}},setAttribute(){},replaceChildren(){this.children=[];},append(...items){this.children.push(...items);},close(){},showModal(){},focus(){},checkValidity(){return true;}}; }
  const elements = new Map();
  const doc = {getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element,createTextNode:text=>text};
  const previousImage = global.Image;
  global.Image = class {async decode(){}};
  try {
    let result;
    const picker = createPitchReleasePicker(doc,value=>{result=value;});
    await picker.open({...preview,settings:{...preview.settings,search_extension_feet:6,search_contact_feet:3},review_frames:[89,90,91,92,93].map(frame=>({frame,image:'image'}))});
    const get = name=>doc.getElementById('pv-'+name);
    assert.equal(get('confirm-release').disabled,true);
    get('frame-next').onclick();
    get('select-half').onclick();
    assert.equal(get('before-label').textContent,'Frame 90');
    assert.equal(get('after-label').textContent,'Frame 91');
    get('confirm-release').onclick();
    assert.equal(result.release,90.5);
    get('select-after').onclick();get('confirm-release').onclick();assert.equal(result.release,91);
    assert.equal(get('before-label').textContent,'Frame 90');
    assert.equal(get('after-label').textContent,'Frame 91');
    get('select-before').onclick();get('confirm-release').onclick();assert.equal(result.release,90);
    get('select-after').onclick();
    get('frame-prev').onclick();get('confirm-release').onclick();assert.equal(result.release,90);
    get('frame-next').onclick();get('confirm-release').onclick();assert.equal(result.release,91);
    assert.equal(get('timeline').min,89);
    assert.equal(get('timeline').max,93);
    get('timeline').value = '92.5';
    get('timeline').oninput();
    get('confirm-release').onclick();
    assert.equal(result.release,92.5);
    assert.equal(get('before-label').textContent,'Frame 92');
    assert.equal(get('after-label').textContent,'Frame 93');
  } finally { if(previousImage === undefined)delete global.Image;else global.Image=previousImage; }
});
