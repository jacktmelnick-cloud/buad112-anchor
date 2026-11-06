// Loopholes found in review (2026-11-05, round 3). Each test is a way to cheat that must not work.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdle, startSession, tick, setPhone, setSimulatedDistance, setDemoSpeed, snapshot } from '../src/engine.js';
import { createStore } from '../src/store.js';
import { LEVEL_MS, SNITCH_COUNTDOWN_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 60, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };

function advance(state, from, duration, step = 250) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

describe('snitch', () => {
  test('quick off-and-on toggles do not restart the countdown; it still sends', () => {
    const reach = (levelIndexOf('snitch') * LEVEL_MS) / 6 + 250;
    let s = setPhone(setDemoSpeed(startSession(createIdle(), CONFIG, T0), 6), true, T0);
    s = advance(s, T0, reach);
    let t = T0 + reach;
    assert.equal(snapshot(s, t).snitch?.phase, 'countdown');
    // 6 s of countdown, a 1 s dodge off the phone, then back on.
    s = advance(s, t, 6000);
    t += 6000;
    s = setPhone(s, false, t);
    s = advance(s, t, 1000);
    t += 1000;
    s = setPhone(s, true, t);
    s = advance(s, t, SNITCH_COUNTDOWN_MS - 6000 + 250);
    t += SNITCH_COUNTDOWN_MS - 6000 + 250;
    assert.equal(snapshot(s, t).snitch?.phase, 'sent');
  });

  test('the countdown pauses while you are off the phone, so it never sends while you are off', () => {
    const reach = (levelIndexOf('snitch') * LEVEL_MS) / 6 + 250;
    let s = setPhone(setDemoSpeed(startSession(createIdle(), CONFIG, T0), 6), true, T0);
    s = advance(s, T0, reach + 5000);
    const t = T0 + reach + 5000;
    s = setPhone(s, false, t);
    s = advance(s, t, 2000); // off the phone: the countdown is paused
    assert.equal(s.snitch.sentAt, null);
  });
});

describe('toggling while away', () => {
  test('toggling the phone while away, then coming back on it, resumes the same step', () => {
    let s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
    s = advance(s, T0, 5 * LEVEL_MS + 1000); // step 6
    let t = T0 + 5 * LEVEL_MS + 1000;
    s = setSimulatedDistance(s, 80);
    for (let i = 0; i < 4; i += 1) {
      s = advance(s, t, 10_000);
      t += 10_000;
      s = setPhone(s, i % 2 === 0 ? false : true, t);
    }
    s = setPhone(s, true, t);
    const pickupsBefore = s.pickups;
    s = setSimulatedDistance(s, 5);
    const snap = snapshot(s, t);
    assert.equal(snap.phone.level, 5, 'held at step 6 the whole time away');
    assert.equal(s.pickups, pickupsBefore + 1, 'coming back on the phone is a new pickup');
  });
});

describe('saves from the gradual-cooldown version', () => {
  test('load with the punishment clock matching the timer', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-old-')), 'session.json');
    const s = startSession(createIdle(), CONFIG, T0);
    const { awayMs, ...old } = { ...s, pressureMs: 40_000, stintMs: 0, pickups: 2 };
    fs.writeFileSync(file, JSON.stringify(old));
    const loaded = createStore(file, { info() {}, error() {} }).load(T0 + 1000);
    assert.equal(loaded.pressureMs, 0);
    assert.equal(loaded.stintMs, 0);
  });
});
