// Away from the anchor, the phone is just a phone: no escalation, no effects, no penalty.
// The study timer pauses until you come back (or you press Stop, which is unlocked out there).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createIdle, startSession, tick, setPhone, setSimulatedDistance, confess, stopSession, snapshot,
} from '../src/engine.js';
import { createPlan, planEffects, overlayFrame } from '../src/effects.js';
import { createStore } from '../src/store.js';
import { LEVEL_MS, CONFESSION_PHRASE } from '../src/config.js';
import { levelIndexOf, MAX_LEVEL } from '../src/ladder.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 60, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };
const AWAY_M = 75;

function advance(state, from, duration, step = 500) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

const running = () => startSession(createIdle(), CONFIG, T0);

describe('on the phone while away', () => {
  test('nothing escalates, nothing is charged, and the study timer pauses', () => {
    let s = setPhone(setSimulatedDistance(running(), AWAY_M), true, T0);
    s = advance(s, T0, 5 * 60_000);
    const snap = snapshot(s, T0 + 5 * 60_000);
    assert.equal(snap.away, true);
    assert.equal(snap.phone.level, 0);
    assert.equal(snap.phone.totalMs, 0, 'phone time away is not counted against you');
    assert.equal(snap.cost, 0);
    assert.equal(snap.study.penaltyMs, 0);
    assert.equal(snap.study.elapsedMs, 0, 'study timer paused while away');
    assert.equal(s.awayMs, 5 * 60_000);
    assert.equal(snap.confession.required, false);
    assert.equal(snap.snitch, null);
  });

  test('a pickup while away is not counted', () => {
    const s = setPhone(setSimulatedDistance(running(), AWAY_M), true, T0);
    assert.equal(s.pickups, 0);
  });

  test('walking away mid-escalation stops it climbing and holds the step for when you come back', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, 4 * LEVEL_MS + 1000);
    assert.equal(snapshot(s, T0 + 4 * LEVEL_MS + 1000).phone.level, 4);
    s = setSimulatedDistance(s, AWAY_M);
    const t = T0 + 4 * LEVEL_MS + 1000;
    s = advance(s, t, 5000);
    assert.equal(snapshot(s, t + 5000).phone.level, 4, 'holds while away');
    s = advance(s, t + 5000, 10 * LEVEL_MS);
    assert.equal(snapshot(s, t + 5000 + 10 * LEVEL_MS).phone.level, 4, 'still held, never reset');
  });

  test('coming back while still on the phone counts as a fresh pickup and escalation resumes', () => {
    let s = setPhone(setSimulatedDistance(running(), AWAY_M), true, T0);
    s = advance(s, T0, 30_000);
    s = setSimulatedDistance(s, 10);
    assert.equal(s.pickups, 1);
    assert.equal(s.stintMs, 0);
    s = advance(s, T0 + 30_000, LEVEL_MS + 500);
    const snap = snapshot(s, T0 + 30_000 + LEVEL_MS + 500);
    assert.equal(snap.away, false);
    assert.equal(snap.phone.level, 1);
  });

  test('you can still stop, or keep the session going and come back', () => {
    const away = setSimulatedDistance(running(), AWAY_M);
    assert.equal(snapshot(away, T0).canStop, true);
    assert.equal(stopSession(away, T0 + 1000).status, 'done');
    const back = setSimulatedDistance(away, 0);
    assert.equal(snapshot(back, T0).away, false);
    assert.equal(back.status, 'running');
  });

  test('the confession is never required away, even at the top step', () => {
    let s = setPhone(running(), true, T0);
    s = advance(s, T0, (MAX_LEVEL + 1) * LEVEL_MS, 1000);
    const top = T0 + (MAX_LEVEL + 1) * LEVEL_MS;
    assert.equal(snapshot(s, top).confession.required, true);
    s = setSimulatedDistance(s, AWAY_M);
    assert.equal(snapshot(s, top).confession.required, false);
    assert.equal(confess(s, CONFESSION_PHRASE, top), s, 'nothing to confess away');
  });

  test('summary reports time away separately', () => {
    let s = setSimulatedDistance(running(), AWAY_M);
    s = advance(s, T0, 60_000);
    const done = stopSession(s, T0 + 60_000);
    assert.equal(snapshot(done, T0 + 60_000).summary.awayMs, 60_000);
  });
});

describe('effects while away', () => {
  test('the overlay and every Mac effect turn off the moment you are away', () => {
    let s = setPhone(running(), true, T0);
    const end = T0 + levelIndexOf('siren') * LEVEL_MS + 1000;
    s = advance(s, T0, end - T0, 1000);
    const loud = planEffects(createPlan(), snapshot(s, end), end);
    assert.ok(loud.actions.some((a) => a.type === 'siren' && a.on));

    const away = setSimulatedDistance(s, AWAY_M);
    const awaySnap = snapshot(away, end);
    assert.equal(overlayFrame(awaySnap, 0).active, false);
    const quiet = planEffects(loud.plan, awaySnap, end);
    assert.ok(quiet.actions.some((a) => a.type === 'siren' && a.on === false));
    assert.ok(quiet.actions.some((a) => a.type === 'volume' && a.floor === null));
    assert.equal(quiet.actions.some((a) => ['tick', 'say', 'notify'].includes(a.type)), false);
  });
});

describe('saved sessions from before away-mode', () => {
  test('load without an away counter', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-away-')), 'session.json');
    const { awayMs, ...old } = running();
    fs.writeFileSync(file, JSON.stringify(old));
    const loaded = createStore(file, { info() {}, error() {} }).load(T0 + 1000);
    assert.equal(loaded.status, 'running');
    assert.equal(loaded.awayMs, 0);
  });
});
