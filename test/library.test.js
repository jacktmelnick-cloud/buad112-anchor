// Library mode: a toggle set before starting. No sound at all (no ticking, voice, siren, notification
// sounds, or volume changes); the three sound-only steps are cut, so each remaining step lasts 20 s.
// The deposit still starts going at 3:00 on the phone.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ladderFor } from '../src/ladder.js';
import { LEVEL_MS, QUIET_LEVEL_MS } from '../src/config.js';
import { parseStart } from '../src/validate.js';
import { createIdle, startSession, tick, setPhone, snapshot } from '../src/engine.js';
import { createPlan, planEffects, overlayFrame } from '../src/effects.js';
import { createMacEffects } from '../src/mac.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const T0 = 1_700_000_000_000;
const QUIET = { studyMinutes: 120, dollarsPerMinute: 2.5, courseName: 'BUAD 112', quiet: true, deposit: 5 };

function advance(state, from, duration, step = 500) {
  let s = state;
  for (let t = from + step; t <= from + duration; t += step) s = tick(s, t);
  return s;
}

const quietOnPhoneFor = (ms) => advance(setPhone(startSession(createIdle(), QUIET, T0), true, T0), T0, ms);

describe('ladders', () => {
  test('normal mode keeps all 13 steps every 15 seconds', () => {
    const normal = ladderFor(false);
    assert.equal(normal.levelMs, LEVEL_MS);
    assert.equal(normal.steps.length, 13);
  });

  test('library mode cuts the sound steps and runs every 20 seconds', () => {
    const quiet = ladderFor(true);
    assert.equal(QUIET_LEVEL_MS, 20_000);
    assert.equal(quiet.levelMs, 20_000);
    assert.deepEqual(quiet.steps.map((s) => s.id), [
      'clock', 'pulse', 'blur', 'shake', 'cost', 'notify', 'penalty', 'snitch', 'confess', 'deposit',
    ]);
  });

  test('the deposit starts going at 3:00 in both modes', () => {
    for (const quiet of [false, true]) {
      const ladder = ladderFor(quiet);
      assert.equal(ladder.stepAt('deposit') * ladder.levelMs, 180_000);
    }
  });
});

describe('the toggle', () => {
  test('is accepted before starting and defaults to off', () => {
    assert.equal(parseStart({ studyMinutes: 25, quiet: true }).value.quiet, true);
    assert.equal(parseStart({ studyMinutes: 25 }).value.quiet, false);
    assert.equal(parseStart({ studyMinutes: 25, quiet: 'yes' }).ok, false);
  });
});

describe('a library-mode session', () => {
  test('steps every 20 seconds: red at 0:20, blur at 0:40, shake at 1:00', () => {
    const at = (ms) => snapshot(quietOnPhoneFor(ms), T0 + ms).phone;
    assert.equal(at(19_500).levelId, 'clock');
    assert.equal(at(20_000).levelId, 'pulse');
    assert.equal(at(40_000).levelId, 'blur');
    assert.equal(at(60_000).levelId, 'shake');
    assert.equal(at(60_000).maxLevel, 9);
  });

  test('says it is in library mode', () => {
    assert.equal(snapshot(quietOnPhoneFor(1000), T0 + 1000).quiet, true);
  });

  test('takes the first dollar of the deposit at 3:00', () => {
    assert.equal(snapshot(quietOnPhoneFor(180_000), T0 + 180_000).deposit.left, 4);
  });

  test('never makes a sound or touches the volume, even at the top step', () => {
    const s = quietOnPhoneFor(200_000);
    let plan = createPlan();
    const types = new Set();
    for (let t = 0; t < 60_000; t += 100) {
      const planned = planEffects(plan, snapshot(s, T0 + 200_000), T0 + 200_000 + t);
      plan = planned.plan;
      planned.actions.forEach((a) => {
        types.add(a.type);
        if (a.type === 'notify') assert.equal(a.silent, true, 'notifications are silent');
      });
    }
    for (const sound of ['tick', 'say', 'siren', 'volume']) assert.equal(types.has(sound), false, sound);
    assert.ok(types.has('notify'), 'the banners still come');
  });

  test('keeps the visual punishments: blur and shake', () => {
    const frame = overlayFrame(snapshot(quietOnPhoneFor(61_000), T0 + 61_000), 0);
    assert.ok(frame.blur > 0);
    assert.ok(frame.shakeAmp > 0);
    assert.ok(frame.pulseAlpha > 0);
  });
});

describe('silent notifications on the Mac', () => {
  test('a silent notify action posts the banner without a sound', () => {
    const calls = [];
    const runner = {
      sync: () => '',
      async: async () => '',
      launch: (cmd, args) => {
        calls.push([cmd, ...args]);
        return { on() {}, kill() {} };
      },
    };
    const volumeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-lib-')), 'v.json');
    const fx = createMacEffects({ tickPath: '/t', sirenPath: '/s', volumeFile, runner, log: { info() {}, error() {} } });
    fx.run({ type: 'notify', title: 'Anchor', body: 'hi', silent: true });
    assert.doesNotMatch(calls[0][2], /sound name/);
  });
});
