// The 15-second grace period. The phone timer you see and the clock that sets the punishment are the
// same clock: step = floor(timer / 15 s). Get back on within the grace period and both continue;
// stay off for the full grace period and both reset to zero / step 1.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createIdle, startSession, tick, setPhone, snapshot } from '../src/engine.js';
import { LEVEL_MS, GRACE_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 60, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };

function advance(state, from, duration, step = 250) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

const running = () => startSession(createIdle(), CONFIG, T0);

describe('grace period', () => {
  test('is 15 seconds, one step long', () => {
    assert.equal(GRACE_MS, 15_000);
    assert.equal(GRACE_MS, LEVEL_MS);
  });

  test('after a full grace period off, the timer AND the punishment start over: ticking lands at 0:30, not earlier', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 25_000); // 0:25 on the phone, step 2
    s = setPhone(s, false, T0 + 25_000);
    s = advance(s, T0 + 25_000, GRACE_MS + 250); // off for the whole grace period
    let t = T0 + 25_000 + GRACE_MS + 250;
    const off = snapshot(s, t);
    assert.equal(off.phone.stintMs, 0, 'timer reset');
    assert.equal(off.phone.level, 0, 'punishment reset');

    s = setPhone(s, true, t);
    s = advance(s, t, 20_000);
    t += 20_000;
    const at20 = snapshot(s, t);
    assert.equal(at20.phone.stintMs, 20_000);
    assert.ok(at20.phone.level < levelIndexOf('tick'), 'no ticking at 0:20');
    s = advance(s, t, 10_250);
    const at30 = snapshot(s, t + 10_250);
    assert.equal(at30.phone.level, levelIndexOf('tick'), 'ticking at 0:30');
  });

  test('back on within the grace period, the timer and the step continue from where they were', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 25_000);
    s = setPhone(s, false, T0 + 25_000);
    s = advance(s, T0 + 25_000, 5000);
    s = setPhone(s, true, T0 + 30_000);
    const snap = snapshot(s, T0 + 30_000);
    assert.equal(snap.phone.stintMs, 25_000, 'timer picks up at 0:25, it does not reset to 0:00');
    assert.equal(snap.phone.level, 1);
    s = advance(s, T0 + 30_000, 5250);
    assert.equal(snapshot(s, T0 + 35_250).phone.level, levelIndexOf('tick'), 'ticking at 0:30 on the timer');
  });

  test('the step always equals the timer divided by 15 seconds while on the phone', () => {
    let s = setPhone(running(), true, T0);
    let t = T0;
    for (const [onFor, offFor] of [[22_000, 4000], [9000, 16_000], [40_000, 14_000], [7000, 0]]) {
      s = advance(s, t, onFor);
      t += onFor;
      const snap = snapshot(s, t);
      assert.equal(snap.phone.level, Math.min(snap.phone.maxLevel, Math.floor(snap.phone.stintMs / LEVEL_MS)));
      if (offFor) {
        s = setPhone(s, false, t);
        s = advance(s, t, offFor);
        t += offFor;
        s = setPhone(s, true, t);
      }
    }
  });

  test('while off, the page knows how long is left and which step a quick return lands on', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 31_000);
    s = setPhone(s, false, T0 + 31_000);
    s = advance(s, T0 + 31_000, 6000);
    const snap = snapshot(s, T0 + 37_000);
    assert.equal(snap.phone.graceLeftMs, 9000);
    assert.equal(snap.phone.restingLevel, 2);
    const later = snapshot(advance(s, T0 + 37_000, 9250), T0 + 46_250);
    assert.equal(later.phone.graceLeftMs, null);
    assert.equal(later.phone.restingLevel, null);
  });

  test('a quick return is the same pickup; a return after the grace period is a new one', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 10_000);
    s = setPhone(s, false, T0 + 10_000);
    s = setPhone(s, true, T0 + 12_000);
    assert.equal(s.pickups, 1);
    s = setPhone(s, false, T0 + 12_000);
    s = advance(s, T0 + 12_000, GRACE_MS + 500);
    s = setPhone(s, true, T0 + 12_000 + GRACE_MS + 500);
    assert.equal(s.pickups, 2);
  });
});
