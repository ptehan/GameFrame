const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('ev-predictor/app.js','utf8');
function fixture(){
 let now=0,id=0;const timers=new Map(),handlers={};
 const prompt={hidden:true,style:{},offsetWidth:0,closest:()=>surface,parentElement:null};
 const surface={querySelectorAll:()=>[prompt],addEventListener:(name,callback)=>handlers[name]=callback};prompt.parentElement=surface;
 const c=vm.createContext({setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source.slice(source.indexOf('const markingPromptState ='),source.indexOf('function setWorkflowVideoPrompt(')),c);
 return {c,prompt,handlers,advance(ms){now+=ms;for(const [key,t]of [...timers])if(t.at<=now){timers.delete(key);t.fn();}}};
}
test('marking message disappears after a brief flash',()=>{
 const f=fixture();f.c.flashMarkingPrompt(f.prompt,'Click the ball');assert.equal(f.prompt.hidden,false);
 f.advance(2799);assert.equal(f.prompt.hidden,false);f.advance(1);assert.equal(f.prompt.hidden,true);
});
test('repeating the same instruction cannot keep it covering the image',()=>{
 const f=fixture();f.c.flashMarkingPrompt(f.prompt,'Click the ball');f.advance(500);f.c.flashMarkingPrompt(f.prompt,'Click the ball');
 f.advance(2300);assert.equal(f.prompt.hidden,true);
});
test('a new instruction gets its own flash and cancels the previous timer',()=>{
 const f=fixture();f.c.flashMarkingPrompt(f.prompt,'Home');f.advance(500);f.c.flashMarkingPrompt(f.prompt,'Rubber');
 f.advance(2300);assert.equal(f.prompt.hidden,false);assert.equal(f.prompt.textContent,'Rubber');f.advance(500);assert.equal(f.prompt.hidden,true);
});
for(const event of ['pointerdown','wheel'])test('interacting with the image dismisses the message: '+event,()=>{
 const f=fixture();f.c.flashMarkingPrompt(f.prompt,'Home');f.handlers[event]();assert.equal(f.prompt.hidden,true);
});
test('returning to a screen can flash its instruction again',()=>{
 const f=fixture();f.c.flashMarkingPrompt(f.prompt,'Home');f.advance(2800);f.c.dismissMarkingPrompt(f.prompt,true);
 f.c.flashMarkingPrompt(f.prompt,'Home');assert.equal(f.prompt.hidden,false);
});
