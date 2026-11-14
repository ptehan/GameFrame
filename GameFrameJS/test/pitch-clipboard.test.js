const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const template = fs.readFileSync(path.join(__dirname,'../templates/pitch_release_test.html'),'utf8');

test('library offers speed export only when pitch speed has been saved', () => {
  const vm = require('node:vm');
  const library = fs.readFileSync(path.join(__dirname,'../templates/library.html'),'utf8');
  const source = library.slice(library.indexOf('function buildGrid(items)'),library.indexOf('function renderInfo(c)'));
  const grid = {};
  const build = vm.runInNewContext(source+'\nbuildGrid',{
    document:{getElementById:()=>grid,querySelectorAll:()=>[]},fType:{value:'pitch'},selectedByType:{pitch:new Set()},
    normalizeFilterValue:value=>value,multiSelectMode:false,sid:'x',modalSafeUrl:value=>value,
    formatLibraryDate:value=>value,bindSelectionCheckboxes(){},refreshBulkSelectionUI(){}
  });
  const pitch={id:61,type:'pitch',pitcher_name:'Pitcher',speed_review:'/pitch/speed?id=61',play:'/play/pitch?id=61'};
  build([pitch]);
  assert.match(grid.innerHTML,/Set Pitch Speed/);
  assert.doesNotMatch(grid.innerHTML,/Export with Pitch Speed/);
  build([{...pitch,speed_export:'/export/pitch-speed?id=61',initial_mph:77.6,average_mph:73.9}]);
  assert.match(grid.innerHTML,/Edit Pitch Speed/);
  assert.match(grid.innerHTML,/Export with Pitch Speed/);
  assert.match(grid.innerHTML,/77.6 mph out of the hand \| 73.9 mph average/);
  assert.match(grid.innerHTML,/href="\/export\/pitch-speed\?id=61"/);
  build([{...pitch,speed_export:'/download/pitch-speed?id=61',speed_export_saved:true,initial_mph:77.6,average_mph:73.9}]);
  assert.match(grid.innerHTML,/Download Saved Export/);
  assert.doesNotMatch(grid.innerHTML,/Edit Pitch Speed|Set Pitch Speed|Export with Pitch Speed/);
});

test('manual preview uses an exact half-frame timeline without AI, collage, or clipboard workflow', () => {
  assert.doesNotMatch(template,/Copy prompt|Copy image|Analyze Pitch|OPENAI_API_KEY|pitch-vision\/analyze|clipboard|collage/i);
  assert.match(template,/\/api\/pitch-release\/preview/);
  assert.match(template,/Previous Frame/);
  assert.match(template,/Next Frame/);
  assert.match(template,/Release frame or halfway gap/);
  assert.match(template,/<input id="pv-timeline"[^>]*type="range"[^>]*step="0\.5"/);
  assert.doesNotMatch(template,/form\.requestSubmit\(\)/);
  for (const id of ['pv-status','pv-pick-release','pv-speed','pv-save']) {
    assert.ok(template.indexOf('id="'+id+'"') < template.indexOf('id="pv-video"'));
  }
  assert.doesNotMatch(template,/overflow(?:-x)?:auto|pv-manual-extension|pv-manual-contact/);
});

test('integrated review waits for settings and navigates to the pitch library only after saving', async () => {
  const vm = require('node:vm');
  const {calculateManualPitch} = require('../static/js/pitch-release-picker');
  const elements = new Map();
  const element = () => ({value:'',children:[],dataset:{},selectedOptions:[],checkValidity(){return true;},removeAttribute(){},
    append(child){this.children.push(child);},replaceChildren(){this.children=[];}});
  const get = id => {if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const destination = '/library?sid=x&type=pitch&pitch_id=61';
  get('pv-integration').textContent = JSON.stringify({id:61,continue_url:destination});
  const extension=element(),contact=element(); extension.value='6';contact.value='3';
  get('pv-form').elements={namedItem:name=>name==='search_extension_feet'?extension:contact};
  const snapshot={selection:{start:89,end:93},contact_frame:119,timing_fps:60,settings:{pitching_feet:60.5}};
  let requests=0,opens=0,confirm,navigated;
  vm.runInNewContext(template.match(/<script>([\s\S]*?)<\/script>/)[1],{
    document:{getElementById:get,createElement:element,querySelector:selector=>get(selector)},calculateManualPitch,FormData:class {},
    window:{location:{assign:url=>{navigated=url;}}},
    createPitchReleasePicker(doc,callback){confirm=callback;return {reset(){},async open(){opens++;}};},
    fetch:async url=>{requests++;return {ok:true,json:async()=>url.includes('/preview')?snapshot:{speed:calculateManualPitch(snapshot,90.5,6,3)}};}
  });
  assert.equal(requests,0);assert.equal(opens,0);
  assert.equal(get('.pv').dataset.step,'setup');
  assert.equal(get('pv-save').hidden,true);
  get('pv-pitch').value='61';
  await get('pv-form').onsubmit({preventDefault(){}});
  assert.equal(opens,1);assert.equal(navigated,undefined);
  confirm(calculateManualPitch(snapshot,90.5,6,3));
  assert.equal(get('.pv').dataset.step,'review');
  assert.equal(get('pv-save').hidden,false);
  await get('pv-save').onclick();
  assert.equal(navigated,destination);
  assert.equal(requests,2);
});

test('distance edits recalculate the retained release without requesting frames again', async () => {
  const vm = require('node:vm');
  const {calculateManualPitch} = require('../static/js/pitch-release-picker');
  const elements = new Map();
  function element() {
    return {value:'',children:[],selectedOptions:[],valid:true,hidden:false,
      append(child){this.children.push(child);},replaceChildren(){this.children=[];},
      checkValidity(){return this.valid;},removeAttribute(){}};
  }
  const get = id => { if (!elements.has(id)) elements.set(id,element()); return elements.get(id); };
  const extension = element(), contact = element();
  extension.value = '6'; contact.value = '3';
  get('pv-form').elements = {namedItem:name=>name==='search_extension_feet'?extension:contact};
  const snapshot = {selection:{start:89,end:93},contact_frame:119,timing_fps:60,settings:{pitching_feet:60.5}};
  let confirm, requests = 0, opens = 0, resets = 0;
  vm.runInNewContext(template.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document:{getElementById:get,createElement:element},calculateManualPitch,
    createPitchReleasePicker(doc,callback){confirm=callback;return {reset(){resets++;},async open(){opens++;}};},
    FormData:class {},fetch:async()=>{requests++;return {ok:true,json:async()=>snapshot};}
  });
  get('pv-pitch').value = '61';
  await get('pv-form').onsubmit({preventDefault(){}});
  confirm(calculateManualPitch(snapshot,90.5,6,3));
  const resetCount = resets;
  extension.value = '7';
  get('pv-settings').oninput({target:extension});
  assert.equal(get('pv-speed').children[0].textContent,calculateManualPitch(snapshot,90.5,7,3).mph.toFixed(1)+' mph out of the hand');
  contact.value = '4';
  get('pv-settings').oninput({target:contact});
  assert.equal(get('pv-speed').children[1].textContent,calculateManualPitch(snapshot,90.5,7,4).average.toFixed(1)+' mph average');
  assert.equal(snapshot.settings.search_contact_feet,4);
  extension.valid = false;
  get('pv-settings').oninput({target:extension});
  assert.equal(get('pv-speed').hidden,true);
  extension.valid = true;
  get('pv-settings').oninput({target:extension});
  assert.equal(get('pv-speed').hidden,false);
  assert.equal(get('pv-speed').children.length,2);
  assert.equal(requests,1);
  assert.equal(opens,1);
  assert.equal(resets,resetCount);
});
