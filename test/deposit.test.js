// The $5 deposit. Placed when the session starts; from 3:00 on the phone it loses $1, then $1 every
// minute after, until it's empty. It follows the phone timer, which never resets during a session,
// so a lost dollar stays lost. Also: the confession pops up only once per session.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIdle, startSession, tick, setPhone, setSimulatedDistance, confess, stopSession, snapshot,
} from '../src/engine.js';
import { overlayFrame } from '../src/effects.js';
import { createStore } from '../src/store.js';
import { LADDER, MAX_LEVEL, levelIndexOf } from '../src/ladder.js';
import { LEVEL_MS, DEPOSIT_DOLLARS, CONFESSION_PHRASE } from '../src/config.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 120, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };

function advance(state, from, duration, step = 1000) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

const running = () => startSession(createIdle(), CONFIG, T0);
const onPhoneFor = (ms) => advance(setPhone(running(), true, T0), T0, ms);

describe('the deposit', () => {
  test('is $5, placed when the session starts', () => {
    assert.equal(DEPOSIT_DOLLARS, 5);
    assert.deepEqual(snapshot(running(), T0).deposit, { total: 5, left: 5, lost: 0, nextBite: 1 });
  });

  test('is the final step on the ladder, at 3:00 on the phone', () => {
    assert.equal(LADDER.length, 13);
    assert.equal(LADDER[MAX_LEVEL].id, 'deposit');
    assert.equal(levelIndexOf('deposit') * LEVEL_MS, 180_000);
  });

  test('is untouched before 3:00 on the phone', () => {
    assert.equal(snapshot(onPhoneFor(179_000), T0 + 179_000).deposit.left, 5);
  });

  test('$5 goes $1.00 at 3:00, $1.56 at 4:00, the last $2.44 at 5:00', () => {
    const at = (ms) => snapshot(onPhoneFor(ms), T0 + ms).deposit.left;
    assert.equal(at(180_000), 4);
    assert.equal(at(239_000), 4);
    assert.equal(at(240_000), 2.44);
    assert.equal(at(300_000), 0);
    assert.equal(at(600_000), 0, 'never below zero');
  });

  test('a lost dollar stays lost: off the phone and away the balance holds', () => {
    let s = onPhoneFor(250_000); // $2.44 left
    let t = T0 + 250_000;
    s = setPhone(s, false, t);
    s = advance(s, t, 10 * 60_000, 5000);
    t += 10 * 60_000;
    assert.equal(snapshot(s, t).deposit.left, 2.44);
    s = setPhone(setSimulatedDistance(s, 80), true, t);
    s = advance(s, t, 5 * 60_000, 5000);
    t += 5 * 60_000;
    assert.equal(snapshot(s, t).deposit.left, 2.44, 'away the phone is free, nothing is taken');
    s = setSimulatedDistance(s, 0);
    s = advance(s, t, 50_000);
    assert.equal(snapshot(s, t + 50_000).deposit.left, 0, 'back on at the anchor, the last bite goes at 5:00 on the timer');
  });

  test('shows up in the summary', () => {
    let s = onPhoneFor(245_000);
    s = stopSession(setSimulatedDistance(setPhone(s, false, T0 + 245_000), 80), T0 + 245_000);
    const summary = snapshot(s, T0 + 245_000).summary;
    assert.equal(summary.depositLeft, 2.44);
    assert.equal(summary.depositLost, 2.56);
  });

  test('is in the overlay frame so the floating bar can show the balance', () => {
    const s = onPhoneFor(181_000);
    const frame = overlayFrame(snapshot(s, T0 + 181_000), 0);
    assert.equal(frame.depositLeft, 4);
    assert.equal(frame.depositTotal, 5);
  });
});

describe('the confession pops up only once per session', () => {
  const confessStep = levelIndexOf('confess') * LEVEL_MS;

  test('after confessing, it never comes back, even minutes later', () => {
    let s = onPhoneFor(confessStep + 1000);
    let t = T0 + confessStep + 1000;
    assert.equal(snapshot(s, t).confession.required, true);
    s = confess(s, CONFESSION_PHRASE, t);
    s = advance(s, t, 10 * 60_000, 5000);
    t += 10 * 60_000;
    assert.equal(snapshot(s, t).confession.required, false);
  });

  test('getting off the phone while it is up also ends it for the session', () => {
    let s = onPhoneFor(confessStep + 1000);
    let t = T0 + confessStep + 1000;
    s = setPhone(s, false, t);
    s = setPhone(s, true, t + 5000);
    s = advance(s, t + 5000, 60_000, 5000);
    assert.equal(snapshot(s, t + 65_000).confession.required, false);
  });

  test('survives a server restart', () => {
    let s = onPhoneFor(confessStep + 1000);
    s = confess(s, CONFESSION_PHRASE, T0 + confessStep + 1000);
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-confess-')), 'session.json');
    const store = createStore(file, { info() {}, error() {} });
    store.save(s);
    store.flush();
    const loaded = createStore(file, { info() {}, error() {} }).load(T0 + confessStep + 5000);
    assert.equal(snapshot(loaded, T0 + confessStep + 5000).confession.required, false);
  });
});
