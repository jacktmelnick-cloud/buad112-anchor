import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdle,
  startSession,
  tick,
  setPhone,
  updateLocation,
  setSimulatedDistance,
  setDemoSpeed,
  confess,
  stopSession,
  resetSession,
  snapshot,
} from '../src/engine.js';
import { LEVEL_MS, CONFESSION_PHRASE, SNITCH_COUNTDOWN_MS, CONFESSION_GRACE_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const ANCHOR = { lat: 34.0224, lng: -118.2851, accuracy: 12 };
const CONFIG = { studyMinutes: 25, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };

function running(overrides = {}) {
  return startSession(createIdle(), { ...CONFIG, ...overrides }, T0);
}

/** Advance real time in 250 ms steps, the same cadence as the server loop. */
function advance(state, fromMs, durationMs, stepMs = 250) {
  let s = state;
  for (let t = fromMs + stepMs; t <= fromMs + durationMs; t += stepMs) s = tick(s, t);
  return s;
}

describe('startSession', () => {
  test('starts a running session with the study target in milliseconds', () => {
    const s = running();
    assert.equal(s.status, 'running');
    assert.equal(s.studyTargetMs, 25 * 60_000);
    assert.equal(s.studyElapsedMs, 0);
    assert.equal(s.onPhone, false);
  });

  test('does not start a second session over a running one', () => {
    const s = running();
    assert.equal(startSession(s, CONFIG, T0 + 1000), s);
  });
});

describe('tick', () => {
  test('counts study time down in real time at 1x', () => {
    const s = advance(running(), T0, 10_000);
    assert.equal(s.studyElapsedMs, 10_000);
    assert.equal(snapshot(s, T0 + 10_000).study.remainingMs, 25 * 60_000 - 10_000);
  });

  test('runs 6x faster in demo speed', () => {
    const s = advance(setDemoSpeed(running(), 6), T0, 1000);
    assert.equal(s.studyElapsedMs, 6000);
  });

  test('never mutates the state it was given', () => {
    const s = running();
    const before = structuredClone(s);
    tick(setPhone(s, true, T0), T0 + 5000);
    assert.deepEqual(s, before);
  });

  test('finishes the session when the study timer hits zero and turns the phone off', () => {
    let s = setPhone(running({ studyMinutes: 1 }), true, T0);
    s = advance(s, T0, 61_000);
    assert.equal(s.status, 'done');
    assert.equal(s.onPhone, false);
    assert.equal(s.endedEarly, false);
  });
});

describe('phone escalation', () => {
  test('climbs one level every 30 seconds on the phone', () => {
    let s = setPhone(running(), true, T0);
    assert.equal(snapshot(s, T0).phone.level, 0);
    s = advance(s, T0, LEVEL_MS);
    assert.equal(snapshot(s, T0 + LEVEL_MS).phone.level, 1);
    s = advance(s, T0 + LEVEL_MS, LEVEL_MS * 2 + 5000);
    assert.equal(snapshot(s, T0 + LEVEL_MS * 3 + 5000).phone.level, 3);
  });

  test('caps at the top of the ladder', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, LEVEL_MS * 30, 1000);
    const snap = snapshot(s, T0 + LEVEL_MS * 30);
    assert.equal(snap.phone.level, snap.phone.maxLevel);
  });

  test('decays one level per 30 seconds off the phone instead of resetting', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 95_000); // level 3
    s = setPhone(s, false, T0 + 95_000);
    s = advance(s, T0 + 95_000, 30_000);
    assert.equal(snapshot(s, T0 + 125_000).phone.restingLevel, 2);
  });

  test('a quick off-and-on toggle does not reset the level', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 60_000); // level 2
    s = setPhone(s, false, T0 + 60_000);
    s = advance(s, T0 + 60_000, 2000);
    s = setPhone(s, true, T0 + 62_000);
    assert.equal(snapshot(s, T0 + 62_000).phone.level, 1);
  });

  test('counts pickups only when going onto the phone', () => {
    let s = running();
    s = setPhone(s, true, T0);
    s = setPhone(s, true, T0 + 10);
    s = setPhone(s, false, T0 + 20);
    s = setPhone(s, true, T0 + 30);
    assert.equal(s.pickups, 2);
  });

  test('keeps the phone stint and total separate from the study timer', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 20_000);
    s = setPhone(s, false, T0 + 20_000);
    s = advance(s, T0 + 20_000, 10_000);
    s = setPhone(s, true, T0 + 30_000);
    s = advance(s, T0 + 30_000, 5000);
    const snap = snapshot(s, T0 + 35_000);
    assert.equal(snap.phone.totalMs, 25_000);
    assert.equal(snap.phone.stintMs, 5000);
    assert.equal(snap.study.elapsedMs, 35_000);
  });

  test('tracks tuition cost from total phone time', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 120_000);
    assert.equal(snapshot(s, T0 + 120_000).cost, 5);
  });
});

describe('penalty', () => {
  const penaltyStart = levelIndexOf('penalty') * LEVEL_MS;

  test('adds nothing before the penalty level', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, penaltyStart - 1000);
    assert.equal(s.penaltyMs, 0);
  });

  test('adds two study seconds per phone second once reached', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, penaltyStart + 10_000);
    assert.equal(s.penaltyMs, 20_000);
    assert.equal(s.studyTargetMs, 25 * 60_000 + 20_000);
  });
});

describe('location and stopping', () => {
  test('anchors at the first location fix and reports distance', () => {
    let s = updateLocation(running(), ANCHOR, T0);
    s = updateLocation(s, { lat: ANCHOR.lat + 0.0002, lng: ANCHOR.lng, accuracy: 10 }, T0 + 1000);
    const loc = snapshot(s, T0 + 1000).location;
    assert.equal(loc.hasAnchor, true);
    assert.ok(loc.distanceM > 20 && loc.distanceM < 25, `distance ${loc.distanceM}`);
    assert.equal(loc.inside, true);
  });

  test('keeps Stop locked when location is unknown', () => {
    const s = running();
    assert.equal(snapshot(s, T0).canStop, false);
    assert.equal(stopSession(s, T0), s);
  });

  test('keeps Stop locked inside the radius', () => {
    const s = setSimulatedDistance(updateLocation(running(), ANCHOR, T0), 30);
    assert.equal(snapshot(s, T0).canStop, false);
    assert.equal(stopSession(s, T0 + 10).status, 'running');
  });

  test('unlocks Stop outside the radius and ends the session early', () => {
    const s = setSimulatedDistance(running(), 60);
    assert.equal(snapshot(s, T0).canStop, true);
    const done = stopSession(s, T0 + 1000);
    assert.equal(done.status, 'done');
    assert.equal(done.endedEarly, true);
  });

  test('going back to real location clears the simulated distance', () => {
    let s = setSimulatedDistance(updateLocation(running(), ANCHOR, T0), 80);
    s = setSimulatedDistance(s, null);
    assert.equal(snapshot(s, T0).location.simulated, false);
    assert.equal(snapshot(s, T0).location.distanceM, 0);
  });
});

describe('snitch', () => {
  const snitchStart = levelIndexOf('snitch') * LEVEL_MS;

  test('counts down 10 real seconds after reaching the snitch level, then sends', () => {
    let s = setPhone(setDemoSpeed(running(), 6), true, T0);
    const reach = Math.ceil(snitchStart / 6) + 250;
    s = advance(s, T0, reach);
    const countdown = snapshot(s, T0 + reach).snitch;
    assert.equal(countdown.phase, 'countdown');
    assert.ok(countdown.secondsLeft <= 10 && countdown.secondsLeft > 8);
    s = advance(s, T0 + reach, SNITCH_COUNTDOWN_MS + 500);
    assert.equal(snapshot(s, T0 + reach + SNITCH_COUNTDOWN_MS + 500).snitch.phase, 'sent');
  });

  test('getting off the phone during the countdown cancels it', () => {
    let s = setPhone(setDemoSpeed(running(), 6), true, T0);
    const reach = Math.ceil(snitchStart / 6) + 250;
    s = advance(s, T0, reach);
    s = setPhone(s, false, T0 + reach);
    s = advance(s, T0 + reach, SNITCH_COUNTDOWN_MS + 500);
    assert.equal(s.snitch.sentAt, null);
    assert.equal(snapshot(s, T0 + reach + SNITCH_COUNTDOWN_MS + 500).snitch, null);
  });
});

describe('confession', () => {
  function atTop() {
    const s = setPhone(running(), true, T0);
    return advance(s, T0, LEVEL_MS * 12, 1000);
  }
  const now = T0 + LEVEL_MS * 12;

  test('is required at the top level', () => {
    assert.equal(snapshot(atTop(), now).confession.required, true);
  });

  test('ignores the wrong sentence', () => {
    const s = atTop();
    assert.equal(confess(s, 'let me scroll', now), s);
  });

  test('accepts the phrase regardless of case and punctuation, for 30 seconds', () => {
    const shouted = `${CONFESSION_PHRASE.toUpperCase()}!!`;
    const s = confess(atTop(), shouted, now);
    assert.equal(snapshot(s, now + 1000).confession.required, false);
    assert.equal(snapshot(s, now + CONFESSION_GRACE_MS + 1).confession.required, true);
  });
});

describe('summary', () => {
  test('grades a session with no phone time as 100 and an A', () => {
    let s = running({ studyMinutes: 1 });
    s = advance(s, T0, 60_000);
    const summary = snapshot(s, T0 + 60_000).summary;
    assert.equal(summary.focusScore, 100);
    assert.equal(summary.grade, 'A');
  });

  test('takes phone time out of the focus score', () => {
    let s = setPhone(running({ studyMinutes: 1 }), true, T0);
    s = advance(s, T0, 15_000);
    s = setPhone(s, false, T0 + 15_000);
    s = advance(s, T0 + 15_000, 45_000);
    const summary = snapshot(s, T0 + 60_000).summary;
    assert.equal(summary.focusScore, 75);
    assert.equal(summary.grade, 'C');
    assert.equal(summary.pickups, 1);
  });

  test('scales the score by how much of the session was completed when ended early', () => {
    let s = setSimulatedDistance(running({ studyMinutes: 10 }), 70);
    s = advance(s, T0, 300_000, 1000);
    const summary = snapshot(stopSession(s, T0 + 300_000), T0 + 300_000).summary;
    assert.equal(summary.endedEarly, true);
    assert.equal(summary.focusScore, 50);
  });

  test('reset returns a finished session to idle and leaves running ones alone', () => {
    const r = running();
    assert.equal(resetSession(r), r);
    const done = stopSession(setSimulatedDistance(r, 70), T0 + 1000);
    assert.equal(resetSession(done).status, 'idle');
  });
});
