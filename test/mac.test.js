import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMacEffects, restorePendingVolume } from '../src/mac.js';

const quietLog = { info() {}, error() {} };

/** A fake Mac: tracks output volume and records every command. */
function fakeMac(initial = { level: 0, muted: true }) {
  const volume = { ...initial };
  const calls = [];
  const osascript = (args) => {
    const script = args.filter((_, i) => i % 2 === 1).join('\n');
    if (script.includes('get volume settings')) return `${volume.level},${volume.muted}`;
    const level = script.match(/output volume (\d+)/);
    if (level) volume.level = Number(level[1]);
    if (script.includes('without output muted')) volume.muted = false;
    else if (script.includes('with output muted')) volume.muted = true;
    return '';
  };
  const runner = {
    sync: (cmd, args) => {
      calls.push([cmd, ...args]);
      return cmd === 'osascript' ? osascript(args) : '';
    },
    async: async (cmd, args) => {
      calls.push([cmd, ...args]);
      return cmd === 'osascript' ? osascript(args) : '';
    },
    launch: (cmd, args) => {
      calls.push([cmd, ...args]);
      return { on() {}, kill() {} };
    },
  };
  return { volume, calls, runner };
}

const volumeFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-vol-')), 'volume.json');

function effects(mac, file, silent = false) {
  return createMacEffects({ tickPath: '/t.wav', sirenPath: '/s.wav', volumeFile: file, silent, runner: mac.runner, log: quietLog });
}

describe('volume floor', () => {
  test('unmutes and raises a muted Mac, and remembers the original on disk', async () => {
    const mac = fakeMac({ level: 0, muted: true });
    const file = volumeFile();
    const fx = effects(mac, file);
    fx.run({ type: 'volume', floor: 35 });
    await fx.whenIdle();
    assert.deepEqual(mac.volume, { level: 35, muted: false });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { level: 0, muted: true });
  });

  test('puts the exact original volume back and deletes the record', async () => {
    const mac = fakeMac({ level: 12, muted: true });
    const file = volumeFile();
    const fx = effects(mac, file);
    fx.run({ type: 'volume', floor: 70 });
    fx.run({ type: 'volume', floor: null });
    await fx.whenIdle();
    assert.deepEqual(mac.volume, { level: 12, muted: true });
    assert.equal(fs.existsSync(file), false);
  });

  test('leaves a Mac that is already loud enough alone', async () => {
    const mac = fakeMac({ level: 60, muted: false });
    const fx = effects(mac, volumeFile());
    fx.run({ type: 'volume', floor: 35 });
    await fx.whenIdle();
    assert.equal(mac.calls.filter((c) => c.join(' ').includes('set volume')).length, 0);
  });

  test('pushes the floor back up if it was turned down mid-step', async () => {
    const mac = fakeMac({ level: 0, muted: true });
    const fx = effects(mac, volumeFile());
    fx.run({ type: 'volume', floor: 35 });
    await fx.whenIdle();
    mac.volume.level = 5;
    fx.run({ type: 'volume', floor: 35 });
    await fx.whenIdle();
    assert.equal(mac.volume.level, 35);
  });

  test('stopAll restores synchronously, for process exit', async () => {
    const mac = fakeMac({ level: 20, muted: false });
    const fx = effects(mac, volumeFile());
    fx.run({ type: 'volume', floor: 70 });
    await fx.whenIdle();
    fx.stopAll();
    assert.deepEqual(mac.volume, { level: 20, muted: false });
  });

  test('silent mode never touches the volume or plays sound', async () => {
    const mac = fakeMac();
    const fx = effects(mac, volumeFile(), true);
    fx.run({ type: 'volume', floor: 35 });
    fx.run({ type: 'tick' });
    fx.run({ type: 'say', text: 'hi' });
    fx.run({ type: 'siren', on: true });
    await fx.whenIdle();
    assert.equal(mac.calls.length, 0);
  });
});

describe('restorePendingVolume', () => {
  test('restores a volume left behind by a crash, then forgets it', () => {
    const mac = fakeMac({ level: 70, muted: false });
    const file = volumeFile();
    fs.writeFileSync(file, JSON.stringify({ level: 25, muted: true }));
    restorePendingVolume({ volumeFile: file, runner: mac.runner, log: quietLog });
    assert.deepEqual(mac.volume, { level: 25, muted: true });
    assert.equal(fs.existsSync(file), false);
  });

  test('does nothing when there is nothing to restore', () => {
    const mac = fakeMac();
    restorePendingVolume({ volumeFile: volumeFile(), runner: mac.runner, log: quietLog });
    assert.equal(mac.calls.length, 0);
  });
});

describe('commands', () => {
  test('speech ends options with -- so text can never become a flag', () => {
    const mac = fakeMac();
    effects(mac, volumeFile()).run({ type: 'say', text: '-f /etc/passwd' });
    assert.deepEqual(mac.calls[0], ['say', '-r', '185', '--', '-f /etc/passwd']);
  });

  test('notifications quote their text and stay silent in silent mode', () => {
    const loud = fakeMac();
    effects(loud, volumeFile()).run({ type: 'notify', title: 'Anchor', body: 'say "hi"' });
    assert.match(loud.calls[0][2], /display notification "say \\"hi\\"" with title "Anchor" sound name "Funk"/);
    const quiet = fakeMac();
    effects(quiet, volumeFile(), true).run({ type: 'notify', title: 'Anchor', body: 'x' });
    assert.doesNotMatch(quiet.calls[0][2], /sound name/);
  });

  test('ticks and the siren use afplay with the generated files', () => {
    const mac = fakeMac();
    const fx = effects(mac, volumeFile());
    fx.run({ type: 'tick' });
    fx.run({ type: 'siren', on: true });
    fx.run({ type: 'siren', on: true });
    assert.deepEqual(mac.calls[0], ['afplay', '-v', '1', '/t.wav']);
    assert.deepEqual(mac.calls[1], ['afplay', '/s.wav']);
    assert.equal(mac.calls.length, 2, 'a running siren is not started twice');
  });
});
