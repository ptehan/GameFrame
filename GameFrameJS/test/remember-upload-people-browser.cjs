const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const kind of ['pitcher','hitter']){
   for(const scenario of ['valid','deleted-team','wrong-team-player','explicit','malformed','blocked']){
    const page=await browser.newPage();
    await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:`<form><select id="team_select"><option value="">Team</option><option value="1">One</option><option value="2">Two</option></select><select id="${kind}_select"><option value="">Player</option></select></form>`}));
    await page.goto('http://fixture.test/');
    await page.evaluate(({kind,scenario})=>{
     const team=document.getElementById('team_select'),player=document.getElementById(kind+'_select');
     team.onchange=()=>{player.innerHTML='<option value="">Player</option>'+({1:'<option value="11">Eleven</option>',2:'<option value="22">Twenty-two</option>'}[team.value]||'');};
     const key=kind==='pitcher'?'gameframe-pitch-people':'gameframe-ev-people';
     localStorage.setItem(key,scenario==='malformed'?'broken':JSON.stringify({team:scenario==='deleted-team'?99:1,[kind]:scenario==='wrong-team-player'?22:11}));
     if(scenario==='explicit'){team.value='2';team.onchange();player.value='22';}
     if(scenario==='blocked'){Storage.prototype.getItem=()=>{throw new Error('blocked');};Storage.prototype.setItem=()=>{throw new Error('blocked');};}
    },{kind,scenario});
    await page.addScriptTag({path:path.resolve('static/js/remember-upload-people.js')});
    assert.equal(await page.locator('#team_select').inputValue(),scenario==='explicit'?'2':['deleted-team','malformed','blocked'].includes(scenario)?'':'1');
    assert.equal(await page.locator('#'+kind+'_select').inputValue(),scenario==='explicit'?'22':scenario==='valid'?'11':'');
    await page.locator('#team_select').selectOption('2');await page.locator('#'+kind+'_select').selectOption('22');
    if(scenario!=='blocked')assert.deepEqual(await page.evaluate(kind=>JSON.parse(localStorage.getItem(kind==='pitcher'?'gameframe-pitch-people':'gameframe-ev-people')),kind),{team:2,[kind]:22});
    await page.close();
   }
  }
  console.log('PASS: pitch/swing remembered choices, deleted team, wrong-team player, explicit precedence, malformed and unavailable storage.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
