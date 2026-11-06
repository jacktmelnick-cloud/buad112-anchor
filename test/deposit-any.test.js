// The deposit is typed in: any amount, or nothing. Nothing means no deposit step at all.
// Any amount drains on the same exponential curve (ratio ≈ 1.5616); it burns for
// n = 3 + round(log2(amount / 5)) minutes, clamped to 1-15, which gives $5→3, $10→4, $25→5, $50→6, $100→7.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { depositSchedule, depositMinutes, DEPOSIT_LOSS_RATIO, DEPOSIT_MAX } from '../src/deposit.js';
import { parseStart } from '../src/validate.js';
import { createIdle, startSession, tick, setPhone, stopSession, setSimulatedDistance, snapshot } from '../src/engine.js';
import { overlayFrame } from '../src/effects.js';
import { ladderFor } from '../src/ladder.js';

const T0 = 1_700_000_000_000;
const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

describe('any amount', () => {
  test('burns longer the more you put down', () => {
    assert.deepEqual([5, 10, 25, 50, 100].map(depositMinutes), [3, 4, 5, 6, 7]);
    assert.equal(depositMinutes(1), 1);
    assert.equal(depositMinutes(7.5), 4);
    assert.equal(depositMinutes(20), 5);
    assert.equal(depositMinutes(1000), 11);
    assert.equal(depositMinutes(DEPOSIT_MAX), 14);
    assert.equal(depositMinutes(0), 0);
  });

  for (const amount of [0.5, 1, 3, 7.5, 12.34, 20, 40, 75, 250, 1000]) {
    test(`$${amount} drains to exactly $0 on the 1.56x curve`, () => {
      const bites = depositSchedule(amount);
      assert.equal(sum(bites), amount);
      bites.slice(1).forEach((bite, i) => assert.ok(bite > bites[i], `bite ${i + 2} is bigger`));
      if (bites.length > 2) {
        const ratio = bites[bites.length - 2] / bites[bites.length - 3];
        assert.ok(Math.abs(ratio - DEPOSIT_LOSS_RATIO) < 0.05, `ratio ${ratio}`);
      }
    });
  }

  test('$5 is still $1.00, $1.56, $2.44', () => {
    assert.deepEqual(depositSchedule(5), [1, 1.56, 2.44]);
  });
});

describe('typing it in', () => {
  test('accepts any amount up to the max, with cents', () => {
    assert.equal(parseStart({ studyMinutes: 25, deposit: 12.5 }).value.deposit, 12.5);
    assert.equal(parseStart({ studyMinutes: 25, deposit: DEPOSIT_MAX }).value.deposit, DEPOSIT_MAX);
  });

  test('leaving it empty means no deposit', () => {
    assert.equal(parseStart({ studyMinutes: 25 }).value.deposit, 0);
    assert.equal(parseStart({ studyMinutes: 25, deposit: null }).value.deposit, 0);
    assert.equal(parseStart({ studyMinutes: 25, deposit: 0 }).value.deposit, 0);
  });

  test('rejects negative, absurd, or non-numbers', () => {
    for (const bad of [-1, DEPOSIT_MAX + 1, 'lots', 1.234]) {
      assert.equal(parseStart({ studyMinutes: 25, deposit: bad }).ok, false, String(bad));
    }
  });
});

describe('no deposit', () => {
  const noDeposit = () => setPhone(startSession(createIdle(), { studyMinutes: 120, dollarsPerMinute: 1, courseName: 'X' }, T0), true, T0);

  test('takes the deposit step out of the ladder', () => {
    assert.equal(ladderFor(false, false).steps.some((s) => s.id === 'deposit'), false);
    assert.equal(ladderFor(false, false).steps.length, 12);
    assert.equal(ladderFor(true, false).steps.length, 9);
    let s = noDeposit();
    for (let t = T0 + 1000; t <= T0 + 600_000; t += 1000) s = tick(s, t);
    const snap = snapshot(s, T0 + 600_000);
    assert.equal(snap.phone.levelId, 'confess', 'the top step is the confession');
    assert.equal(snap.phone.maxLevel, 11);
    assert.equal(snap.deposit, null);
  });

  test('shows no balance on the floating bar and none in the summary', () => {
    let s = noDeposit();
    for (let t = T0 + 1000; t <= T0 + 200_000; t += 1000) s = tick(s, t);
    assert.equal(overlayFrame(snapshot(s, T0 + 200_000), 0).depositLeft, null);
    const done = stopSession(setSimulatedDistance(setPhone(s, false, T0 + 200_000), 80), T0 + 200_000);
    const summary = snapshot(done, T0 + 200_000).summary;
    assert.equal(summary.depositLeft, null);
    assert.equal(summary.depositLost, null);
  });
});

describe('a typed amount in a session', () => {
  test('$12.50 takes its first bite at 3:00', () => {
    let s = setPhone(startSession(createIdle(), { studyMinutes: 120, dollarsPerMinute: 1, courseName: 'X', deposit: 12.5 }, T0), true, T0);
    for (let t = T0 + 1000; t <= T0 + 180_000; t += 1000) s = tick(s, t);
    const d = snapshot(s, T0 + 180_000).deposit;
    assert.equal(d.total, 12.5);
    assert.equal(d.lost, depositSchedule(12.5)[0]);
  });
});

describe('a corrupted save', () => {
  test('a worst step past the end of its ladder does not crash the summary', () => {
    let s = setPhone(startSession(createIdle(), { studyMinutes: 120, dollarsPerMinute: 1, courseName: 'X' }, T0), true, T0);
    s = tick(s, T0 + 1000);
    const corrupted = { ...s, maxLevel: 12 };
    const done = stopSession(setSimulatedDistance(setPhone(corrupted, false, T0 + 1000), 80), T0 + 1000);
    assert.equal(snapshot(done, T0 + 1000).summary.maxLevelName, 'Confession');
  });
});
