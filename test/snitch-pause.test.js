// The snitch countdown is measured in time spent on the phone at the anchor, so a long pause
// (laptop asleep, server restart) can never make it fire the moment you pick the phone back up.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdle, startSession, tick, setPhone, setSimulatedDistance, setDemoSpeed, snapshot } from '../src/engine.js';
import { createStore } from '../src/store.js';
import { LEVEL_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 120, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };
const quietLog = { info() {}, error() {} };

function advance(state, from, duration, step = 250) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

function atCountdown(secondsIn) {
  const reach = (levelIndexOf('snitch') * LEVEL_MS) / 6 + 250;
  let s = setPhone(setDemoSpeed(startSession(createIdle(), CONFIG, T0), 6), true, T0);
  s = advance(s, T0, reach + secondsIn * 1000);
  return { s, t: T0 + reach + secondsIn * 1000 };
}

describe('snitch countdown across long pauses', () => {
  test('a 10-minute pause mid-countdown resumes the countdown instead of sending instantly', () => {
    let { s, t } = atCountdown(4);
    s = setPhone(s, false, t);
    t += 10 * 60_000;
    s = tick(s, t); // one big gap, like a sleeping laptop
    s = setPhone(s, true, t);
    s = tick(s, t + 250);
    const view = snapshot(s, t + 250).snitch;
    assert.equal(view?.phase, 'countdown');
    assert.ok(view.secondsLeft >= 5 && view.secondsLeft <= 6, `secondsLeft ${view?.secondsLeft}`);
  });

  test('a server restart mid-countdown while off the phone keeps the countdown where it was', () => {
    let { s, t } = atCountdown(4);
    s = setPhone(s, false, t);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-snitch-')), 'session.json');
    const store = createStore(file, quietLog);
    store.save(s);
    store.flush();
    let loaded = createStore(file, quietLog).load(t + 30 * 60_000);
    loaded = setPhone(loaded, true, t + 30 * 60_000);
    loaded = tick(loaded, t + 30 * 60_000 + 250);
    assert.equal(snapshot(loaded, t + 30 * 60_000 + 250).snitch?.phase, 'countdown');
  });

  test('older saves that stored a wall-clock start just restart the countdown', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-snitch-')), 'session.json');
    const s = startSession(createIdle(), CONFIG, T0);
    fs.writeFileSync(file, JSON.stringify({ ...s, snitch: { startedAt: T0 - 600_000, sentAt: null } }));
    const loaded = createStore(file, quietLog).load(T0 + 1000);
    assert.deepEqual(loaded.snitch, { elapsedMs: null, sentAt: null });
  });
});

describe('pickups near the edge of the zone', () => {
  test('GPS wobbling across the line does not count extra pickups', () => {
    let s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
    for (const meters of [80, 0, 80, 0, 80, 0]) s = setSimulatedDistance(s, meters);
    assert.equal(s.pickups, 1);
  });

  test('picking up away and walking back in on the phone counts once', () => {
    let s = setSimulatedDistance(startSession(createIdle(), CONFIG, T0), 80);
    s = setPhone(s, true, T0);
    for (const meters of [0, 80, 0]) s = setSimulatedDistance(s, meters);
    assert.equal(s.pickups, 1);
  });
});
