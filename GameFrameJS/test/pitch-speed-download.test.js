const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('export shows progress, prevents duplicate requests and restores controls on success or failure',async()=>{
  function element(tag){return {tag,children:[],attrs:{},style:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},append(...nodes){this.children.push(...nodes);},remove(){},addEventListener(){},click(){downloads++;}};}
  let handler,resolveFetch,requests=0,downloads=0,status;
  const button=element('button'),link=element('a');
  link.href='http://localhost/export/pitch-speed?id=61';
  link.querySelector=()=>button;link.after=node=>{status=node;};link.closest=()=>null;
  class TestURL extends URL {static createObjectURL(){return 'blob:test';}static revokeObjectURL(){}}
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/js/pitch-speed-download.js'),'utf8'),{
    document:{addEventListener:(name,fn)=>{handler=fn;},createElement:element,createTextNode:text=>text,body:element('body'),querySelector:()=>null,dispatchEvent(){}},
    CustomEvent:class {constructor(name,options){this.detail=options.detail;}},
    fetch:()=>{requests++;return new Promise(resolve=>{resolveFetch=resolve;});},URL:TestURL,setTimeout(){}
  });
  const event={target:{closest:()=>link},preventDefault(){}};
  const first=handler(event);
  assert.equal(status.children[0].tag,'progress');
  assert.equal(link.attrs['aria-busy'],'true');assert.equal(button.disabled,true);
  await handler(event);assert.equal(requests,1);
  resolveFetch({ok:true,blob:async()=>({})});await first;
  assert.equal(downloads,1);assert.equal(button.disabled,false);
  assert.equal(status.textContent,'Download ready.');
  assert.equal(button.textContent,'Download Saved Export');
  assert.equal(link.href,'http://localhost/download/pitch-speed?id=61');
  const retry=handler(event);
  resolveFetch({ok:false,json:async()=>({error:'Render failed'})});await retry;
  assert.equal(status.textContent,'Render failed');assert.equal(status.attrs.role,'alert');
  assert.equal(button.disabled,false);assert.equal(link.attrs['aria-busy'],undefined);
});
