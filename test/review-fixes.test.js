// Regression tests for the issues found in code review (2026-11-05).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createIdle, startSession, tick, setPhone, updateLocation, setDemoSpeed, stopSession, resetSession, snapshot,
} from '../src/engine.js';
import { createStore } from '../src/store.js';
import { createPlan, planEffects } from '../src/effects.js';
import { parseStart } from '../src/validate.js';
import { LEVEL_MS, SNITCH_COUNTDOWN_MS, SNITCH_SENT_VISIBLE_MS } from '../src/config.js';
import { levelIndexOf } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 60, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };
const quietLog = { info() {}, error() {} };
const METERS_PER_DEG_LAT = 111_195;

function advance(state, from, duration, step = 250) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

describe('sleep and stalls', () => {
  test('a long gap between ticks (laptop asleep) counts as a pause, not phone time', () => {
    const s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
    const woke = tick(s, T0 + 10 * 60_000);
    assert.ok(woke.phoneMs <= 2000, `phoneMs ${woke.phoneMs}`);
    assert.ok(woke.studyElapsedMs <= 2000);
    assert.equal(woke.penaltyMs, 0);
  });
});

describe('location quality', () => {
  const fixAt = (meters, accuracy) => ({ lat: 34 + meters / METERS_PER_DEG_LAT, lng: -118, accuracy });

  test('a rough fix needs a clear margin past 50 m before Stop unlocks', () => {
    let s = updateLocation(startSession(createIdle(), CONFIG, T0), fixAt(0, 10), T0);
    s = updateLocation(s, fixAt(70, 40), T0 + 1000);
    assert.equal(snapshot(s, T0 + 1000).canStop, false, '70 m at ±40 m is not clearly outside');
    s = updateLocation(s, fixAt(100, 40), T0 + 2000);
    assert.equal(snapshot(s, T0 + 2000).canStop, true);
  });

  test('the margin is capped, so terrible accuracy cannot lock Stop forever', () => {
    let s = updateLocation(startSession(createIdle(), CONFIG, T0), fixAt(0, 10), T0);
    s = updateLocation(s, fixAt(105, 900), T0 + 1000);
    assert.equal(snapshot(s, T0 + 1000).canStop, true);
    assert.equal(snapshot(s, T0 + 1000).location.unlockAtM, 100);
  });

  test('a stale fix from before the session is not used as the anchor', () => {
    const idle = updateLocation(createIdle(), fixAt(0, 10), T0);
    const s = startSession(idle, CONFIG, T0 + 5 * 60_000);
    assert.equal(s.location.anchor, null);
    const fresh = startSession(updateLocation(createIdle(), fixAt(0, 10), T0), CONFIG, T0 + 5000);
    assert.notEqual(fresh.location.anchor, null);
  });
});

describe('demo speed', () => {
  test('a finished demo does not leave the next session at 6x', () => {
    let s = setDemoSpeed(startSession(createIdle(), CONFIG, T0), 6);
    s = stopSession({ ...s, location: { ...s.location, simulatedM: 90 } }, T0 + 1000);
    assert.equal(resetSession(s).demoSpeed, 1);
  });
});

describe('snitch', () => {
  test('sends only once per session, even after later pickups', () => {
    const reach = levelIndexOf('snitch') * LEVEL_MS / 6 + 500;
    let s = setPhone(setDemoSpeed(startSession(createIdle(), CONFIG, T0), 6), true, T0);
    s = advance(s, T0, reach + SNITCH_COUNTDOWN_MS + 500);
    assert.notEqual(s.snitch.sentAt, null);
    let t = T0 + reach + SNITCH_COUNTDOWN_MS + 500 + SNITCH_SENT_VISIBLE_MS + 100;
    s = setPhone(tick(s, t), false, t);
    assert.notEqual(s.snitch.sentAt, null, 'stays sent');
    s = setPhone(s, true, t + 10);
    s = advance(s, t + 10, 60_000);
    assert.equal(snapshot(s, t + 60_010).snitch, null, 'no second countdown, no second text');
  });
});

describe('store hardening', () => {
  const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-store-')), 'session.json');
  const saved = (state) => {
    const f = file();
    fs.writeFileSync(f, JSON.stringify(state));
    return f;
  };

  test('drops a saved session whose config is not valid', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const f = saved({ ...s, config: { ...s.config, studyMinutes: 'lots' } });
    assert.equal(createStore(f, quietLog).load(T0), null);
  });

  test('drops non-finite numbers', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const f = file();
    fs.writeFileSync(f, JSON.stringify(s).replace('"pressureMs":0', '"pressureMs":1e999'));
    assert.equal(createStore(f, quietLog).load(T0), null);
  });

  test('resets presenter speed and simulated distance on load', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const f = saved({ ...setDemoSpeed(s, 6), location: { ...s.location, simulatedM: 400 } });
    const loaded = createStore(f, quietLog).load(T0 + 1000);
    assert.equal(loaded.demoSpeed, 1);
    assert.equal(loaded.location.simulatedM, null);
  });

  test('keeps a snitch countdown that was mid-way when the server stopped', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const f = saved({ ...s, onPhone: true, snitch: { elapsedMs: 4000, sentAt: null } });
    const loaded = createStore(f, quietLog).load(T0 + 60_000);
    assert.equal(loaded.snitch.elapsedMs, 4000, 'resumes at 4 s in, neither restarted nor fired');
  });

  test('writes the session readable only by you', () => {
    const f = file();
    const store = createStore(f, quietLog);
    store.save(startSession(createIdle(), CONFIG, T0));
    store.flush();
    assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  });
});

describe('effects order', () => {
  test('the siren stops before the slower volume restore runs', () => {
    let s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
    const end = T0 + levelIndexOf('siren') * LEVEL_MS + 1000;
    s = advance(s, T0, end - T0, 1000);
    const loud = planEffects(createPlan(), snapshot(s, end), end);
    const off = setPhone(s, false, end);
    const types = planEffects(loud.plan, snapshot(off, end), end).actions.map((a) => a.type);
    assert.ok(types.indexOf('siren') < types.indexOf('volume'), types.join());
  });

  test('re-asserts the volume floor every few seconds in case it was turned down', () => {
    let s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
    const end = T0 + levelIndexOf('tick') * LEVEL_MS + 1000;
    s = advance(s, T0, end - T0, 1000);
    const first = planEffects(createPlan(), snapshot(s, end), end);
    const later = planEffects(first.plan, snapshot(s, end), end + 5000);
    assert.ok(later.actions.some((a) => a.type === 'volume' && a.floor === 35));
  });
});

describe('course name', () => {
  test('control and direction-override characters are stripped', () => {
    const r = parseStart({ studyMinutes: 5, courseName: 'BUAD‮ 112\n' });
    assert.equal(r.value.courseName, 'BUAD 112');
  });
});
