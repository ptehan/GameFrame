/* One viewport, one clear next action. Long content advances horizontally. */
(() => {
  'use strict';
  if (window.GameFrameWorkspace) return;
  document.documentElement.classList.add('gf-guided');
  const pagers = new Map();
  let scheduled = false, observer;
  const selectors = '#main, #setup-modal[data-step="player"] #setup-controls-slot';
  function page(root, index) {
    const state = pagers.get(root); if (!state) return;
    state.index = Math.max(0, Math.min(state.count - 1, index));
    root.scrollLeft = state.index * (root.clientWidth + 24);
    state.label.textContent = `${state.index + 1} of ${state.count}`;
    state.previous.hidden = state.index === 0;
    state.next.hidden = state.index >= state.count - 1;
  }
  function wrap(root) {
    if (pagers.has(root)) return;
    const shell = document.createElement('div'); shell.className = 'gf-page-shell';
    const nav = document.createElement('nav'); nav.className = 'gf-page-controls';
    nav.setAttribute('aria-label','Workspace pages'); nav.hidden = true;
    const label = document.createElement('span'); label.setAttribute('aria-live','polite');
    const previous = document.createElement('button'); previous.type='button';previous.textContent='Previous';
    const next = document.createElement('button');next.type='button';next.className='gf-page-next';next.textContent=location.pathname.includes('library')?'Next':'Continue';
    root.before(shell);shell.append(root,nav);nav.append(label,previous,next);root.classList.add('gf-page-flow');
    const state={shell,nav,label,previous,next,index:0,count:1};pagers.set(root,state);
    previous.addEventListener('click',()=>page(root,state.index-1));next.addEventListener('click',()=>page(root,state.index+1));
    root.addEventListener('focusin',event=>{
      const bounds=root.getBoundingClientRect(),box=event.target.getBoundingClientRect();
      if(box.width && (box.left<bounds.left-1 || box.right>bounds.right+1)) page(root,Math.floor((box.left-bounds.left+root.scrollLeft)/(root.clientWidth+24)));
    });
    root.addEventListener('invalid',event=>{
      const bounds=root.getBoundingClientRect(),box=event.target.getBoundingClientRect();
      if(box.width)page(root,Math.floor((box.left-bounds.left+root.scrollLeft)/(root.clientWidth+24)));
    },true);
    root.addEventListener('scroll',()=>{
      const index=Math.round(root.scrollLeft/(root.clientWidth+24));
      if(index!==state.index)page(root,index);
    },{passive:true});
  }
  function secondaryActions() {
    document.querySelectorAll('#library_grid .actions:not([data-guided-actions])').forEach(actions=>{
      actions.dataset.guidedActions='true';
      const oldMenu=actions.querySelector(':scope > .library-more-actions');
      if(oldMenu){Array.from(oldMenu.children).filter(e=>e.tagName!=='SUMMARY').forEach(e=>oldMenu.before(e));oldMenu.remove();}
      const children=Array.from(actions.children).filter(e=>e.matches('a,button,form'));
      const primary=children.find(e=>/^(play|tag start|edit pitch video)/i.test(e.textContent.trim()))||children[0];
      const extras=children.filter(e=>e!==primary);
      if(!extras.length)return;
      const trigger=document.createElement('button');trigger.type='button';trigger.textContent='More';trigger.setAttribute('aria-label','More actions for this video');
      const panel=document.createElement('div');panel.className='gf-actions-popover';panel.id='gf-actions-'+Math.random().toString(36).slice(2);panel.setAttribute('popover','auto');trigger.setAttribute('popovertarget',panel.id);
      extras.forEach(node=>panel.append(node));actions.append(trigger,panel);
    });
    document.querySelectorAll('button:not([data-guided-add])').forEach(button=>{
      const kind=button.textContent.trim().match(/^Add (Team|Hitter|Pitcher)$/i);if(!kind)return;
      const select=button.parentElement.querySelector('select');if(!select)return;
      button.dataset.guidedAdd='true';button.hidden=true;
      const ensure=()=>{if(!Array.from(select.options).some(o=>o.value==='__gf_add'))select.add(new Option(`Add new ${kind[1].toLowerCase()}…`,'__gf_add'));};ensure();
      if(!select.dataset.guidedAdd){select.dataset.guidedAdd='true';let previous=select.value;
        select.addEventListener('pointerdown',()=>previous=select.value);select.addEventListener('focus',()=>previous=select.value);
        select.addEventListener('change',event=>{if(select.value!=='__gf_add'){previous=select.value;return;}event.stopImmediatePropagation();select.value=previous;button.click();},true);
      }
      new MutationObserver(ensure).observe(select,{childList:true});
    });
  }
  function layout() {
    scheduled=false;observer?.disconnect();
    document.documentElement.style.setProperty('--gf-app-height',`${Math.round(window.visualViewport?.height||innerHeight)}px`);
    const side=document.querySelector('#sidebar'),top=document.querySelector('.topbar');
    if(side&&top&&!top.contains(side)){top.append(side);const menu=side.querySelector('details');if(menu)menu.open=false;}
    document.querySelectorAll(selectors).forEach(wrap);
    for(const [root,state] of pagers){
      if(!root.isConnected){pagers.delete(root);continue;}
      if(root.id==='setup-controls-slot'&&root.closest('#setup-modal')?.dataset.step!=='player'){
        root.classList.remove('gf-page-flow');state.shell.before(root);state.shell.remove();pagers.delete(root);continue;
      }
      if(!root.clientWidth||!root.clientHeight)continue;
      state.count=Math.max(1,Math.ceil((root.scrollWidth+24)/(root.clientWidth+24)-.02));
      state.nav.hidden=state.count===1;
      state.count=Math.max(1,Math.ceil((root.scrollWidth+24)/(root.clientWidth+24)-.02));
      const active=document.activeElement;
      if(root.contains(active)&&active!==root&&active!==document.body){const box=active.getBoundingClientRect(),bounds=root.getBoundingClientRect();if(box.width)state.index=Math.floor((box.left-bounds.left+root.scrollLeft)/(root.clientWidth+24));}
      page(root,state.index);
    }
    secondaryActions();
    observer?.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','style','class','data-step','data-stage']});
  }
  function schedule(){if(!scheduled){scheduled=true;requestAnimationFrame(layout);}}
  function init(){
    observer=new MutationObserver(schedule);
    document.addEventListener('toggle',schedule,true);document.addEventListener('load',schedule,true);
    window.addEventListener('resize',schedule);window.visualViewport?.addEventListener('resize',schedule);
    document.addEventListener('click',event=>{
      const actionMenu=event.target.closest('.gf-actions-popover');if(actionMenu&&event.target.closest('a,button'))actionMenu.hidePopover();
      const ev=event.target.closest('[data-ev-start]');if(ev){const entry=document.getElementById('open-ev-modeling');if(entry){event.preventDefault();entry.click();}}
      const menu=document.querySelector('#sidebar .responsive-menu');if(menu?.open&&!menu.contains(event.target))menu.open=false;
      schedule();
    });
    schedule();
  }
  window.GameFrameWorkspace={refresh:schedule,page};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
