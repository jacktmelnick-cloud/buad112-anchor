import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters } from '../src/geo.js';
import { LADDER, MAX_LEVEL, levelForPressure, levelIndexOf, intensity } from '../src/ladder.js';
import { LEVEL_MS } from '../src/config.js';
import { clock, spokenDuration, money } from '../src/format.js';
import { sirenWav, SIREN_SAMPLE_RATE } from '../src/audio.js';
import { normalizePhrase } from '../src/phrase.js';

describe('distanceMeters', () => {
  test('is zero for the same point', () => {
    assert.equal(distanceMeters({ lat: 34, lng: -118 }, { lat: 34, lng: -118 }), 0);
  });

  test('matches one degree of latitude (about 111.2 km)', () => {
    const d = distanceMeters({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(Math.abs(d - 111_195) < 50, `got ${d}`);
  });

  test('measures a 50 m step within a meter', () => {
    const d = distanceMeters({ lat: 34.0224, lng: -118.2851 }, { lat: 34.0224 + 50 / 111_195, lng: -118.2851 });
    assert.ok(Math.abs(d - 50) < 1, `got ${d}`);
  });
});

describe('ladder', () => {
  test('has twelve steps starting with the clock and ending with the confession', () => {
    assert.equal(LADDER.length, 12);
    assert.equal(LADDER[0].id, 'clock');
    assert.equal(LADDER[MAX_LEVEL].id, 'confess');
  });

  test('goes red, then ticking, then blur, then shake, all inside the first minute on the phone', () => {
    assert.deepEqual(LADDER.slice(0, 5).map((s) => s.id), ['clock', 'pulse', 'tick', 'blur', 'shake']);
    assert.ok(levelIndexOf('shake') * LEVEL_MS <= 60_000);
  });

  test('has no drain step any more', () => {
    assert.throws(() => levelIndexOf('drain'));
  });

  test('maps pressure to levels and clamps', () => {
    assert.equal(levelForPressure(0), 0);
    assert.equal(levelForPressure(LEVEL_MS - 1), 0);
    assert.equal(levelForPressure(LEVEL_MS), 1);
    assert.equal(levelForPressure(10 * 60_000), MAX_LEVEL);
    assert.equal(levelForPressure(-5), 0);
  });

  test('finds level indexes by id and rejects unknown ids', () => {
    assert.equal(levelIndexOf('pulse'), 1);
    assert.throws(() => levelIndexOf('nope'));
  });

  test('keeps the red pulse under 3 flashes per second at every level', () => {
    for (let level = 0; level <= MAX_LEVEL; level += 1) {
      const { pulsePeriodMs } = intensity(level);
      if (pulsePeriodMs) assert.ok(1000 / pulsePeriodMs < 3, `level ${level}`);
    }
  });

  test('turns effects on only from their own step', () => {
    const at = levelIndexOf;
    assert.equal(intensity(0).pulseAlpha, 0);
    assert.ok(intensity(at('pulse')).pulseAlpha > 0);
    assert.equal(intensity(at('blur') - 1).blur, 0);
    assert.ok(intensity(at('blur')).blur > 0);
    assert.equal(intensity(at('tick') - 1).tickIntervalMs, null);
    assert.ok(intensity(MAX_LEVEL).tickIntervalMs < intensity(at('tick')).tickIntervalMs);
  });

  test('shakes hard from the shake step and harder after', () => {
    const at = levelIndexOf('shake');
    assert.equal(intensity(at - 1).shakeAmp, 0);
    assert.ok(intensity(at).shakeAmp >= 16, 'starts as a real vibration, not a wobble');
    assert.ok(intensity(MAX_LEVEL).shakeAmp > intensity(at).shakeAmp);
    assert.ok(intensity(MAX_LEVEL).shakeAmp <= 40, 'stays inside the overlay bleed');
    assert.equal('dim' in intensity(MAX_LEVEL), false);
  });
});

describe('format', () => {
  test('clock pads seconds and handles hours', () => {
    assert.equal(clock(0), '0:00');
    assert.equal(clock(65_400), '1:05');
    assert.equal(clock(3_725_000), '1:02:05');
    assert.equal(clock(-500), '0:00');
  });

  test('spoken durations read naturally', () => {
    assert.equal(spokenDuration(150_000), '2 minutes 30 seconds');
    assert.equal(spokenDuration(61_000), '1 minute 1 second');
    assert.equal(spokenDuration(45_000), '45 seconds');
  });

  test('money shows cents', () => {
    assert.equal(money(4.8), '$4.80');
    assert.equal(money(0), '$0.00');
  });
});

describe('sirenWav', () => {
  test('is a valid 16-bit mono WAV of the requested length', () => {
    const buf = sirenWav(1);
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
    assert.equal(buf.readUInt16LE(22), 1);
    assert.equal(buf.readUInt32LE(24), SIREN_SAMPLE_RATE);
    assert.equal(buf.readUInt16LE(34), 16);
    assert.equal(buf.length, 44 + SIREN_SAMPLE_RATE * 2);
  });
});

describe('normalizePhrase', () => {
  test('ignores case, punctuation, and extra spaces', () => {
    assert.equal(normalizePhrase('  I am, choosing MY phone!! '), 'i am choosing my phone');
  });
});
