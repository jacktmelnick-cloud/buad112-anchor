// End-to-end check of the whole flow in a real browser (Chromium via Playwright).
// Starts its own silent server with the Mac overlay off, so it never flashes your screen.
// Usage: npm run e2e [-- <screenshot-dir>]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-shots-')));
const port = 5300 + Math.floor(Math.random() * 500);
const base = `http://localhost:${port}`;
const ANCHOR = { latitude: 34.0224, longitude: -118.2851, accuracy: 15 };

const results = [];
const problems = [];

function check(name, condition, detail = '') {
  results.push(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!condition) problems.push(name);
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-e2e-'));
  const child = spawn(process.execPath, ['src/main.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ANCHOR_SILENT: '1', ANCHOR_OVERLAY: '0', ANCHOR_DATA: dataDir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${base}/api/state`)).ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  throw new Error('Server did not start');
}

const text = (page, sel) => page.locator(sel).innerText();
const rubricStateAt = (page, i) => page.locator('#rubric-list > li').nth(i).getAttribute('data-state');

async function desktopFlow(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, geolocation: ANCHOR, permissions: ['geolocation'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  await page.goto(base);
  await page.locator('#cover').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#anchor-status').dataset.state === 'ready');
  check('cover shows a ready anchor', (await text(page, '#anchor-status-text')).startsWith('Ready right here'));
  check('start button places the $5 deposit', (await text(page, '#start-btn')).includes('Deposit $5'));
  await page.screenshot({ path: path.join(shots, '1-cover-desktop.png') });

  await page.fill('input[name=studyMinutes]', '0');
  await page.click('#start-btn');
  check('rejects 0 minutes on the cover', (await text(page, '#start-error')).includes('1 to 240'));

  await page.fill('input[name=studyMinutes]', '25');
  await page.click('#start-btn');
  check('asks for college tuition before starting', (await text(page, '#start-error')).toLowerCase().includes('tuition'));
  await page.fill('input[name=tuitionPerYear]', '$70,000');
  check('shows the per-minute math live', (await text(page, '#tuition-hint')).includes('$2.59'), await text(page, '#tuition-hint'));

  await page.fill('input[name=studyMinutes]', '25');
  await page.click('#start-btn');
  await page.locator('#session').waitFor({ state: 'visible' });
  const studyTime = await text(page, '#study-time');
  check('session starts at 25 minutes', /^(25:00|24:5\d)$/.test(studyTime), studyTime);
  check('Stop is locked at the anchor', (await page.locator('#stop-btn').isDisabled()) && (await text(page, '#lock-text')).startsWith('Stop locked'));
  check('tab title counts down', (await page.title()).endsWith('left · Anchor'), await page.title());
  await page.screenshot({ path: path.join(shots, '2-session-desktop.png') });

  await page.click('#presenter-toggle');
  await page.click('.seg__btn[data-speed="6"]');
  await page.click('#phone-btn');
  await page.waitForFunction(() => document.querySelector('#phone-btn').getAttribute('aria-pressed') === 'true');
  check('phone button flips to "I\'m off my phone"', (await text(page, '#phone-btn-text')) === "I'm off my phone");
  check('tab title shows phone time', (await page.title()).includes('on your phone'), await page.title());
  check('phone mockup is picked up', (await page.locator('#phone').getAttribute('data-on')) === 'true');

  await page.waitForFunction(() => document.querySelector('#rubric-list').children[2].dataset.state === 'current', null, { timeout: 30_000 });
  check('climbs to step 3 at 6x speed', (await rubricStateAt(page, 0)) === 'reached' && (await rubricStateAt(page, 1)) === 'reached');
  check('in-tab red pulse runs when the overlay is off', (await page.evaluate(() => document.body.dataset.fxPulse)) === 'on');
  await page.screenshot({ path: path.join(shots, '3-on-phone-step3-desktop.png') });

  // Blur waves run on a real-time 5.5 s cycle, so watch them at 1x where the blur step lasts 15 s.
  await page.waitForFunction(() => document.querySelector('#rubric-list').children[3].dataset.state === 'current', null, { timeout: 30_000 });
  await page.click('.seg__btn[data-speed="1"]');
  await page.waitForFunction(() => document.body.dataset.fxBlur === 'on', null, { timeout: 8000 });
  check('step 4 blurs without shaking yet', (await page.evaluate(() => document.body.dataset.fxShake)) === 'off');
  await page.waitForFunction(() => document.body.dataset.fxBlur === 'off', null, { timeout: 8000 });
  check('the blur lifts between waves while still on the phone', (await page.locator('#phone-btn').getAttribute('aria-pressed')) === 'true');
  await page.click('.seg__btn[data-speed="6"]');
  await page.waitForFunction(() => document.querySelector('#rubric-list').children[4].dataset.state === 'current', null, { timeout: 30_000 });
  await page.waitForFunction(() => document.body.dataset.fxShake === 'on', null, { timeout: 8000 });
  check('step 5 blurs and shakes together', (await page.evaluate(() => document.body.dataset.fxBlur)) === 'on');
  const offButtonVisible = await page.locator('#phone-btn').isVisible();
  check('off button stays usable through the blur', offButtonVisible);
  await page.screenshot({ path: path.join(shots, '4-on-phone-step7-desktop.png') });

  await page.waitForFunction(() => !document.querySelector('#confess').hidden, null, { timeout: 40_000 });
  // The page shakes at this step, so submit with Enter (a shaking button never counts as "stable" to Playwright).
  await page.fill('#confess-input', 'whatever');
  await page.press('#confess-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('#session-error').textContent.startsWith('Not quite'));
  check('wrong confession is refused', !(await page.locator('#confess').isHidden()));
  await page.fill('#confess-input', 'i am choosing my phone over my grade!');
  await page.press('#confess-input', 'Enter');
  await page.waitForFunction(() => document.querySelector('#confess').hidden, null, { timeout: 5000 });
  check('right confession hides the popup', await page.locator('#confess').isHidden());
  check('penalty shows on the study timer', (await text(page, '#penalty-note')).includes('added for phone time'));
  await page.waitForFunction(() => document.querySelector('#deposit-left').textContent === '$4', null, { timeout: 15_000 });
  check('3:00 on the phone takes $1 of the deposit', (await page.locator('#deposit-chip').getAttribute('data-lost')) === 'true');
  check('a -$1 floats off the balance', (await page.locator('#deposit-chip .minus').count()) >= 1);
  await page.screenshot({ path: path.join(shots, '5-top-step-desktop.png') });

  await page.click('#phone-btn');
  await page.waitForFunction(() => document.querySelector('#phone-btn').getAttribute('aria-pressed') === 'false');
  check('getting off clears every in-tab effect', (await page.evaluate(() => document.body.dataset.fx)) === 'off');
  check('rubric remembers where the next pickup starts', (await page.locator('#rubric-list > li[data-state="resting"]').count()) === 1);
  check(
    'paused line gives the time, step, and pickups',
    /^Paused at \d+:\d\d, step \d+: .+\. Pick up your phone again and it resumes right there\. \d+ pickups? so far\./.test(await text(page, '#phone-meta')),
    await text(page, '#phone-meta'),
  );
  check('no extra rubric line while paused', (await page.locator('#rubric-sub').textContent()) === '' && !(await page.locator('#rubric-sub').isVisible()));

  await page.locator('#sim-range').fill('70');
  await page.waitForFunction(() => !document.querySelector('#stop-btn').disabled, null, { timeout: 5000 });
  check('walking 70 m unlocks Stop', (await text(page, '#lock-text')).startsWith('Stop unlocked'));

  await page.click('#phone-btn');
  await page.waitForFunction(() => document.querySelector('#phone-btn').getAttribute('aria-pressed') === 'true');
  await page.waitForTimeout(3000); // at 6x that is over a step: nothing may escalate while away
  check('away from the anchor, the phone is free: no effects', (await page.evaluate(() => document.body.dataset.fx)) === 'off');
  check('away from the anchor, the page says so', (await text(page, '#phone-meta')).includes('phone is free'));
  check('away from the anchor, the study timer is paused', /^paused/i.test(await text(page, '#study-label')));
  check('away from the anchor, the rubric does not climb', (await page.locator('#rubric-list > li[data-state="current"]').count()) === 0);
  check('tab title says away', (await page.title()).startsWith('Away'), await page.title());
  await page.click('#phone-btn');
  await page.waitForFunction(() => document.querySelector('#phone-btn').getAttribute('aria-pressed') === 'false');
  await page.click('#stop-btn');
  await page.locator('#summary').waitFor({ state: 'visible' });
  const grade = await text(page, '#grade');
  check('summary hands back a grade', /^[ABCDF][+-]?$/.test(grade), grade);
  check('summary says it ended early', (await text(page, '#summary-sub')).startsWith('Ended early'));
  check('summary shows the deposit kept', /^\$\d of \$5$/.test(await text(page, '#sum-deposit')), await text(page, '#sum-deposit'));
  await page.click('#presenter-toggle');
  await page.waitForTimeout(1300); // let the red circle finish drawing for the screenshot
  await page.screenshot({ path: path.join(shots, '6-summary-desktop.png') });

  await page.click('#again-btn');
  await page.locator('#cover').waitFor({ state: 'visible' });
  check('new session returns to the cover', true);
  check('no page errors on desktop', errors.length === 0, errors.join(' | '));
  await context.close();
}

async function mobileFlow(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    geolocation: ANCHOR,
    permissions: ['geolocation'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator('#cover').waitFor({ state: 'visible' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('cover has no sideways scroll at 390 px', overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: path.join(shots, '7-cover-mobile.png'), fullPage: true });
  await page.fill('input[name=tuitionPerYear]', '70000');
  await page.check('input[name=quiet]');
  await page.click('#start-btn');
  await page.locator('#session').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('#rubric-list > li').length === 10);
  check('library mode shows its 10-step rubric', true);
  check('library mode stamp shows', await page.locator('#quiet-stamp').isVisible());
  check('library mode steps every 20 seconds', (await page.locator('#rubric-list > li .rubric__at').nth(1).textContent()) === '0:20');
  await page.click('#phone-btn');
  const overflowSession = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('session has no sideways scroll at 390 px', overflowSession <= 0, `${overflowSession}px`);
  await page.screenshot({ path: path.join(shots, '8-session-mobile.png'), fullPage: true });
  await page.click('#phone-btn');
  await post(`${base}/api/demo`, { simulatedM: 90 });
  await post(`${base}/api/stop`, {});
  check('no page errors on mobile', errors.length === 0, errors.join(' | '));
  await context.close();
}

function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify(body),
  });
}

const server = await startServer();
const browser = await chromium.launch();
try {
  await desktopFlow(browser);
  await mobileFlow(browser);
} catch (error) {
  check('flow ran to the end', false, error.message.split('\n')[0]);
} finally {
  await browser.close();
  server.kill();
}
process.stdout.write(`${results.join('\n')}\n\nScreenshots: ${shots}\n${problems.length ? `${problems.length} FAILED` : 'ALL PASSED'}\n`);
process.exit(problems.length ? 1 : 0);
