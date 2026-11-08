const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../static/js/tagging-fullscreen.js'),'utf8');

function fixture(denied = false) {
  function element(tag = 'button') {
    const classes = new Set();
    return {tagName:tag.toUpperCase(),dataset:{},children:[],handlers:{},isConnected:true,
      classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},
      setAttribute(name,value){this[name]=value;},
      addEventListener(name,fn){this.handlers[name]=fn;},
      append(child){this.children.push(child);},
      contains(child){return this.children.includes(child)||this.host?.children.includes(child);},
      closest(){return this.id==='setup-modal'?this:null;},
    };
  }
  const root = element('dialog'); root.id='setup-modal'; root.open=true;
  const host = element('header'); root.host=host; root.querySelector=()=>host;
  const doc = {documentElement:element('html'),head:element('head'),body:element('body'),handlers:{},fullscreenElement:null,
    createElement:element,querySelectorAll(selector){return selector==='[data-tagging-fullscreen]'?host.children:[root];},
    addEventListener(name,fn){this.handlers[name]=fn;},
    async exitFullscreen(){this.fullscreenElement=null;this.handlers.fullscreenchange();},
  };
  doc.documentElement.requestFullscreen = async () => {
    if(denied)throw new Error('Fullscreen denied');
    doc.fullscreenElement=doc.documentElement;doc.handlers.fullscreenchange();
  };
  const context={document:doc,window:{dispatchEvent(){}},Event:class {},getComputedStyle:()=>({display:'grid'}),
    MutationObserver:class {constructor(fn){context.observe=fn;}observe(){}},
  };
  vm.runInNewContext(source,context);
  return {root,doc,button:host.children[0],context};
}

test('fullscreen includes the editor and exits without replacing tagging controls',async()=>{
  const {root,doc,button}=fixture();
  await button.handlers.click();
  assert.equal(doc.fullscreenElement,doc.documentElement);
  assert.ok(root.classList.contains('tagging-fullscreen-target'));
  assert.equal(button.textContent,'Exit full screen');
  assert.equal(root.host.children[0],button);
  await button.handlers.click();
  assert.equal(doc.fullscreenElement,null);
  assert.equal(button.textContent,'Full screen');
  assert.ok(!root.classList.contains('tagging-fullscreen-target'));
});

test('browser Escape and editor close both clean up fullscreen state',async()=>{
  const {root,doc,button}=fixture();
  await button.handlers.click();
  doc.fullscreenElement=null;doc.handlers.fullscreenchange();
  assert.equal(button.textContent,'Full screen');
  await button.handlers.click();
  root.handlers.close();
  assert.equal(doc.fullscreenElement,null);
  assert.ok(!root.classList.contains('tagging-fullscreen-target'));
});

test('denied browser fullscreen still expands the editor and Escape restores it',async()=>{
  const {root,doc,button}=fixture(true);
  await button.handlers.click();
  assert.ok(root.classList.contains('tagging-fullscreen-target'));
  let prevented=false;
  doc.handlers.keydown({key:'Escape',preventDefault(){prevented=true;},stopImmediatePropagation(){}});
  assert.equal(prevented,true);
  assert.equal(button.textContent,'Full screen');
});
