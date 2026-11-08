// Explicit browser regression; mocks entity writes so the real database is untouched.
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({channel:'chrome',headless:true});
  try {
    const page = await browser.newPage({serviceWorkers:'block'});
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => console.error('Browser:',error.message));
    const people = {teams:[{id:901,name:'Selection test'}],hitters:[{id:902,name:'Existing batter',team_id:901}]};
    await page.route('**/api/gameframe/options', route => route.fulfill({json:people}));
    await page.route('**/api/gameframe/field-locations', route => route.fulfill({json:{locations:[]}}));
    await page.route('**/api/gameframe/hitter', route => route.fulfill({json:{...people,hitters:[...people.hitters,{id:903,name:'New batter',team_id:901}],hitter:{id:903}}}));
    await page.goto((process.env.GAMEFRAME_TEST_URL || 'http://127.0.0.1:8000')+'/ev/predictor.html',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => typeof openEvPeopleSelection === 'function' && document.querySelector('#gameframe-team option[value="901"]'),null,{timeout:15000});
    console.log('Player options loaded');
    await page.evaluate(() => {openEvPeopleSelection();});
    await page.locator('#gameframe-team').selectOption('901');
    await page.locator('#gameframe-hitter').selectOption('902');
    await page.waitForFunction(() => document.getElementById('actual-field-map-modal').open);
    assert.equal(await page.locator('#ev-people-modal').evaluate(el => el.open),false);
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#gameframe-team option[value="901"]'),null,{timeout:15000});
    await page.evaluate(() => {document.querySelectorAll('dialog[open]').forEach(d=>d.close());openEvPeopleSelection();});
    await page.locator('#gameframe-team').selectOption('901');
    await page.locator('#ev-people-modal .inline-add-panel summary').click();
    await page.locator('#new-hitter-name').fill('New batter');
    await page.locator('#add-hitter').click();
    await page.waitForFunction(() => document.getElementById('actual-field-map-modal').open);
    assert.equal(await page.locator('#gameframe-hitter').inputValue(),'903');
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForFunction(() => document.querySelector('#gameframe-hitter option[value="902"]'),null,{timeout:15000});
    await page.evaluate(() => {document.querySelectorAll('dialog[open]').forEach(d=>d.close());openEvPeopleSelection();document.getElementById('gameframe-hitter').value='902';});
    await page.locator('#ev-people-form button[type=submit]').click();
    await page.waitForFunction(() => document.getElementById('actual-field-map-modal').open);
    await page.evaluate(() => {document.getElementById('actual-field-map-modal').close();openEvPeopleSelection();document.getElementById('gameframe-hitter').value='';});
    await page.locator('#ev-people-form button[type=submit]').click();
    assert.match(await page.locator('#ev-people-status').textContent(),/Choose a team and player/);
    assert.equal(await page.locator('#ev-people-modal').evaluate(el => el.open),true);
    console.log('PASS: existing batter, new batter, explicit Continue and missing-player validation. No database writes.');
  } finally {await browser.close();}
})().catch(error => {console.error(error);process.exitCode=1;});
