// The phone timer and the punishment never reset during a study session. Off the phone or away from
// the anchor they pause; back on the phone at the anchor they resume exactly where they left off.
// step = floor(phone timer / 15 s), always. Only a new session starts from zero.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdle, startSession, tick, setPhone, setSimulatedDistance, stopSession, resetSession, snapshot,
} from '../src/engine.js';
import { LEVEL_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 120, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };
const AWAY_M = 80;

function advance(state, from, duration, step = 500) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

const running = () => startSession(createIdle(), CONFIG, T0);

describe('never resets during a session', () => {
  test('off the phone for 10 minutes, back on resumes the same timer and step', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 47_000); // 0:47, step 4 (blur)
    let t = T0 + 47_000;
    s = setPhone(s, false, t);
    s = advance(s, t, 10 * 60_000, 2000);
    t += 10 * 60_000;
    const off = snapshot(s, t);
    assert.equal(off.phone.stintMs, 47_000, 'timer held at 0:47 while off');
    assert.equal(off.phone.level, levelIndexOf('blur'), 'step held while off');

    s = setPhone(s, true, t);
    s = advance(s, t, 13_500);
    const back = snapshot(s, t + 13_500);
    assert.equal(back.phone.stintMs, 60_500, 'resumed from 0:47');
    assert.equal(back.phone.level, levelIndexOf('shake'), 'and hit the shake at 1:00 on the timer');
  });

  test('away and back resumes where you left off', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 35_000); // 0:35, ticking
    let t = T0 + 35_000;
    s = setSimulatedDistance(s, AWAY_M);
    s = advance(s, t, 5 * 60_000, 2000); // five minutes away, still on the phone (free)
    t += 5 * 60_000;
    assert.equal(snapshot(s, t).phone.stintMs, 35_000);
    s = setSimulatedDistance(s, 0);
    s = advance(s, t, 10_500);
    const back = snapshot(s, t + 10_500);
    assert.equal(back.phone.stintMs, 45_500);
    assert.equal(back.phone.level, levelIndexOf('blur'));
  });

  test('leaving while off the phone, coming back, and going on also resumes', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 20_000);
    let t = T0 + 20_000;
    s = setPhone(s, false, t);
    s = setSimulatedDistance(s, AWAY_M);
    s = advance(s, t, 60_000, 2000);
    t += 60_000;
    s = setSimulatedDistance(s, 0);
    s = setPhone(s, true, t);
    assert.equal(snapshot(s, t).phone.stintMs, 20_000);
    assert.equal(snapshot(s, t).phone.level, 1);
  });

  test('the step always equals the phone timer divided by 15 seconds', () => {
    let s = setPhone(running(), true, T0);
    let t = T0;
    for (const [onFor, offFor] of [[22_000, 4000], [9000, 60_000], [40_000, 14_000], [7000, 0]]) {
      s = advance(s, t, onFor, 250);
      t += onFor;
      const snap = snapshot(s, t);
      assert.equal(snap.phone.level, Math.min(snap.phone.maxLevel, Math.floor(snap.phone.stintMs / LEVEL_MS)));
      if (offFor) {
        s = setPhone(s, false, t);
        s = advance(s, t, offFor, 1000);
        t += offFor;
        s = setPhone(s, true, t);
      }
    }
  });

  test('while off, the page knows the paused timer and step', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 31_000);
    s = setPhone(s, false, T0 + 31_000);
    s = advance(s, T0 + 31_000, 90_000, 2000);
    const snap = snapshot(s, T0 + 121_000);
    assert.equal(snap.phone.restingLevel, 2);
    assert.equal(snap.phone.stintMs, 31_000);
    assert.equal('graceLeftMs' in snap.phone, false);
  });

  test('every time you go back on at the anchor is a pickup', () => {
    let s = setPhone(running(), true, T0);
    s = setPhone(s, false, T0 + 5000);
    s = setPhone(s, true, T0 + 6000);
    s = setPhone(s, false, T0 + 7000);
    s = setSimulatedDistance(s, AWAY_M);
    s = setPhone(s, true, T0 + 8000); // away: free, not a pickup
    s = setSimulatedDistance(s, 0); // back at the anchor still on the phone: a pickup
    assert.equal(s.pickups, 3);
  });

  test('a new session starts from zero', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 40_000);
    s = stopSession(setSimulatedDistance(s, AWAY_M), T0 + 40_000);
    const next = startSession(resetSession(s), CONFIG, T0 + 50_000);
    const snap = snapshot(next, T0 + 50_000);
    assert.equal(snap.phone.stintMs, 0);
    assert.equal(snap.phone.level, 0);
  });
});
