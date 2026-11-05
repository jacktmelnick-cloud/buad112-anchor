import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../src/store.js';
import { asString } from '../src/mac.js';
import { createApp } from '../src/app.js';
import { createIdle, startSession, setPhone } from '../src/engine.js';
import { snitchMessage } from '../src/lines.js';
import { tickWav } from '../src/audio.js';

const quietLog = { info() {}, error() {} };
const T0 = 1_700_000_000_000;

function tempFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-store-')), 'session.json');
}

describe('store', () => {
  test('returns null when nothing was saved yet', () => {
    assert.equal(createStore(tempFile(), quietLog).load(T0), null);
  });

  test('round-trips a session and resumes the clock at load time', () => {
    const file = tempFile();
    const running = startSession(createIdle(), { studyMinutes: 25, dollarsPerMinute: 2.5, courseName: 'BUAD 112' }, T0);
    const store = createStore(file, quietLog);
    store.save(running);
    store.flush();
    const loaded = createStore(file, quietLog).load(T0 + 3_600_000);
    assert.equal(loaded.status, 'running');
    assert.equal(loaded.studyTargetMs, running.studyTargetMs);
    assert.equal(loaded.lastTickAt, T0 + 3_600_000, 'downtime is not counted');
  });

  test('ignores a file that is not a session', () => {
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify({ status: 'running', hacked: true }));
    assert.equal(createStore(file, quietLog).load(T0), null);
    fs.writeFileSync(file, '{not json');
    assert.equal(createStore(file, quietLog).load(T0), null);
  });
});

describe('asString (AppleScript quoting)', () => {
  test('escapes quotes and backslashes so text cannot break out of the string', () => {
    assert.equal(asString('say "hi"'), '"say \\"hi\\""');
    assert.equal(asString('a\\" & do shell script "rm'), '"a\\\\\\" & do shell script \\"rm"');
  });
});

describe('overlay events', () => {
  test('the floating off button and the confession box drive the session', () => {
    let clock = T0;
    const app = createApp({ now: () => clock, effects: { run() {}, stopAll() {} }, log: quietLog });
    app.start({ studyMinutes: 25, dollarsPerMinute: 2.5, courseName: 'BUAD 112' });
    app.phone(true);
    clock += 1000;
    assert.equal(app.handleOverlayEvent({ e: 'off' }).data.phone.onPhone, false);
    assert.equal(app.handleOverlayEvent({ e: 'confess', text: 'x' }).ok, true);
    assert.equal(app.handleOverlayEvent({ e: 'mystery' }), null);
    assert.equal(app.handleOverlayEvent(null), null);
  });

  test('a throwing effect is logged, not fatal', () => {
    const errors = [];
    const app = createApp({
      now: () => T0,
      effects: { run() { throw new Error('afplay missing'); }, stopAll() {} },
      log: { info() {}, error: (m) => errors.push(m) },
    });
    app.start({ studyMinutes: 25, dollarsPerMinute: 2.5, courseName: 'BUAD 112' });
    assert.doesNotThrow(() => app.phone(true));
  });
});

describe('snitch text and tick sound', () => {
  test('the fake text names the course and the phone time', () => {
    const s = setPhone(startSession(createIdle(), { studyMinutes: 25, dollarsPerMinute: 1, courseName: 'BUAD 112' }, T0), true, T0);
    const msg = snitchMessage({ phone: { stintMs: 272_000 }, config: s.config });
    assert.match(msg, /4:32/);
    assert.match(msg, /BUAD 112/);
  });

  test('the tick is a short valid WAV', () => {
    const buf = tickWav();
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
    assert.ok(buf.length < 5000);
  });
});
