import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createIdle, startSession, setPhone, tick, snapshot } from '../src/engine.js';
import { createPlan, planEffects, overlayFrame, VOICE_EVERY_MS, NOTIFY_EVERY_MS, VOLUME_FLOOR } from '../src/effects.js';
import { LEVEL_MS } from '../src/config.js';
import { levelIndexOf, MAX_LEVEL } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const CONFIG = { studyMinutes: 60, dollarsPerMinute: 2.5, courseName: 'BUAD 112' };

/** A running session that has been on the phone long enough to sit at `level`. */
function onPhoneAt(level) {
  let s = setPhone(startSession(createIdle(), CONFIG, T0), true, T0);
  const end = T0 + level * LEVEL_MS + 1000;
  for (let t = T0 + 1000; t <= end; t += 1000) s = tick(s, t);
  return { state: s, now: end, snap: snapshot(s, end) };
}

function types(actions) {
  return actions.map((a) => a.type);
}

describe('planEffects', () => {
  test('does nothing while off the phone', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const { actions } = planEffects(createPlan(), snapshot(s, T0), T0);
    assert.deepEqual(actions, []);
  });

  test('does not tick before the ticking level', () => {
    const { snap, now } = onPhoneAt(1);
    assert.equal(types(planEffects(createPlan(), snap, now).actions).includes('tick'), false);
  });

  test('ticks on its interval from the ticking level', () => {
    const { snap, now } = onPhoneAt(levelIndexOf('tick'));
    const first = planEffects(createPlan(), snap, now);
    assert.ok(types(first.actions).includes('tick'));
    const soon = planEffects(first.plan, snap, now + 100);
    assert.equal(types(soon.actions).includes('tick'), false);
    const later = planEffects(first.plan, snap, now + 1100);
    assert.ok(types(later.actions).includes('tick'));
  });

  test('forces a volume floor once when sound starts and again when the siren starts', () => {
    const tickLevel = onPhoneAt(levelIndexOf('tick'));
    const first = planEffects(createPlan(), tickLevel.snap, tickLevel.now);
    assert.deepEqual(first.actions.find((a) => a.type === 'volume'), { type: 'volume', floor: VOLUME_FLOOR.tick });
    const again = planEffects(first.plan, tickLevel.snap, tickLevel.now + 2000);
    assert.equal(types(again.actions).includes('volume'), false);

    const siren = onPhoneAt(levelIndexOf('siren'));
    const loud = planEffects(first.plan, siren.snap, siren.now);
    assert.deepEqual(loud.actions.find((a) => a.type === 'volume'), { type: 'volume', floor: VOLUME_FLOOR.siren });
    assert.deepEqual(loud.actions.find((a) => a.type === 'siren'), { type: 'siren', on: true });
  });

  test('restores volume and stops the siren the moment you get off the phone', () => {
    const siren = onPhoneAt(levelIndexOf('siren'));
    const loud = planEffects(createPlan(), siren.snap, siren.now);
    const offState = setPhone(siren.state, false, siren.now);
    const quiet = planEffects(loud.plan, snapshot(offState, siren.now), siren.now);
    assert.deepEqual(quiet.actions.find((a) => a.type === 'siren'), { type: 'siren', on: false });
    assert.deepEqual(quiet.actions.find((a) => a.type === 'volume'), { type: 'volume', floor: null });
  });

  test('speaks from the voice level on its own interval', () => {
    const { snap, now } = onPhoneAt(levelIndexOf('voice'));
    const first = planEffects(createPlan(), snap, now);
    const say = first.actions.find((a) => a.type === 'say');
    assert.ok(say && say.text.length > 0);
    assert.equal(types(planEffects(first.plan, snap, now + VOICE_EVERY_MS - 1).actions).includes('say'), false);
    assert.ok(types(planEffects(first.plan, snap, now + VOICE_EVERY_MS).actions).includes('say'));
  });

  test('rotates the spoken lines', () => {
    const { snap, now } = onPhoneAt(levelIndexOf('voice'));
    const first = planEffects(createPlan(), snap, now);
    const second = planEffects(first.plan, snap, now + VOICE_EVERY_MS);
    const a = first.actions.find((x) => x.type === 'say').text;
    const b = second.actions.find((x) => x.type === 'say').text;
    assert.notEqual(a, b);
  });

  test('posts notifications from the notification level', () => {
    const { snap, now } = onPhoneAt(levelIndexOf('notify'));
    const first = planEffects(createPlan(), snap, now);
    const note = first.actions.find((a) => a.type === 'notify');
    assert.ok(note && note.title && note.body);
    assert.ok(types(planEffects(first.plan, snap, now + NOTIFY_EVERY_MS).actions).includes('notify'));
  });
});

describe('overlayFrame', () => {
  test('is inactive and clear while off the phone', () => {
    const s = startSession(createIdle(), CONFIG, T0);
    const frame = overlayFrame(snapshot(s, T0));
    assert.equal(frame.active, false);
    assert.equal(frame.pulseAlpha, 0);
    assert.equal(frame.blur, 0);
  });

  test('shows the phone timer and level from the first second', () => {
    const { snap } = onPhoneAt(0);
    const frame = overlayFrame(snap);
    assert.equal(frame.active, true);
    assert.equal(frame.phoneText, '0:01');
    assert.equal(frame.levelName, 'Clock');
    assert.equal(frame.costText, null);
  });

  test('adds the cost receipt, blur, and shake at their levels', () => {
    assert.match(overlayFrame(onPhoneAt(levelIndexOf('cost')).snap).costText, /^\$\d+\.\d\d of tuition$/);
    const blurred = overlayFrame(onPhoneAt(levelIndexOf('blur')).snap);
    assert.ok(blurred.blur > 0);
    assert.equal(blurred.shake, true);
  });

  test('asks for the confession at the top level', () => {
    const frame = overlayFrame(onPhoneAt(MAX_LEVEL).snap);
    assert.equal(typeof frame.confession, 'string');
  });
});
