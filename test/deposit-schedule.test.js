// Deposit options and the exponential loss schedule.
// Every option drains on the same curve: each minute takes r = (sqrt(17) - 1) / 2 ≈ 1.5616 times the
// minute before (the ratio that turns $5 into exactly $1.00, $1.56, $2.44). Bigger deposits burn for more
// minutes: $5 over 3, $10 over 4, $25 over 5, $50 over 6, $100 over 7. The first bite is sized so the
// deposit hits exactly $0 on its last minute (rounded to cents; the last bite absorbs rounding).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { depositSchedule, DEPOSIT_LOSS_RATIO } from '../src/deposit.js';
import { createIdle, startSession, tick, setPhone, snapshot } from '../src/engine.js';

const T0 = 1_700_000_000_000;
const sum = (xs) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

const DEPOSIT_OPTIONS = [5, 10, 25, 50, 100];

describe('the exponential schedule', () => {
  test('$5 goes $1.00, $1.56, $2.44', () => {
    assert.deepEqual(depositSchedule(5), [1, 1.56, 2.44]);
  });

  test('bigger deposits burn for more minutes', () => {
    assert.deepEqual(DEPOSIT_OPTIONS.map((d) => depositSchedule(d).length), [3, 4, 5, 6, 7]);
  });

  for (const total of [5, 10, 25, 50, 100]) {
    test(`$${total} adds up to exactly $${total}, every bite bigger than the last by about 1.56x`, () => {
      const bites = depositSchedule(total);
      assert.equal(sum(bites), total);
      bites.slice(1).forEach((bite, i) => {
        const ratio = bite / bites[i];
        assert.ok(Math.abs(ratio - DEPOSIT_LOSS_RATIO) < 0.02, `$${total} bite ${i + 2}: ratio ${ratio}`);
      });
    });
  }

  test('a bigger deposit takes a bigger bite at every minute', () => {
    const schedules = DEPOSIT_OPTIONS.map(depositSchedule);
    for (let minute = 0; minute < 3; minute += 1) {
      const bites = schedules.map((s) => s[minute]);
      bites.slice(1).forEach((bite, i) => assert.ok(bite > bites[i], `minute ${minute + 1}`));
    }
  });
});

describe('in a session', () => {
  const onPhoneFor = (deposit, ms) => {
    let s = setPhone(startSession(createIdle(), { studyMinutes: 120, dollarsPerMinute: 1, courseName: 'X', deposit }, T0), true, T0);
    for (let t = T0 + 1000; t <= T0 + ms; t += 1000) s = tick(s, t);
    return snapshot(s, T0 + ms).deposit;
  };

  test('$5: $4.00 left at 3:00, $2.44 at 4:00, empty at 5:00', () => {
    assert.equal(onPhoneFor(5, 179_000).left, 5);
    assert.equal(onPhoneFor(5, 180_000).left, 4);
    assert.equal(onPhoneFor(5, 240_000).left, 2.44);
    assert.equal(onPhoneFor(5, 300_000).left, 0);
  });

  test('$100: first bite at 3:00, empty at 9:00, never below zero', () => {
    const first = depositSchedule(100)[0];
    assert.equal(onPhoneFor(100, 180_000).left, Math.round((100 - first) * 100) / 100);
    assert.ok(onPhoneFor(100, 539_000).left > 0);
    assert.equal(onPhoneFor(100, 540_000).left, 0);
    assert.equal(onPhoneFor(100, 900_000).left, 0);
  });

  test('the snapshot knows the next bite, for the page to show', () => {
    const d = onPhoneFor(10, 200_000);
    assert.equal(d.total, 10);
    assert.equal(d.nextBite, depositSchedule(10)[1]);
  });
});
