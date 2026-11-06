import { LEVEL_MS } from './config.js';

/**
 * The annoyance ladder. One step per LEVEL_MS on the phone; every step keeps the ones before it.
 * @type {ReadonlyArray<{ id: string, name: string, note: string }>}
 */
export const LADDER = Object.freeze(
  [
    { id: 'clock', name: 'Clock', note: 'A phone timer follows you into every app' },
    { id: 'pulse', name: 'Red pulse', note: 'The whole screen pulses red' },
    { id: 'tick', name: 'Ticking', note: 'A clock ticks, faster every step' },
    { id: 'blur', name: 'Blur', note: 'The screen blurs in waves, a few clear seconds between' },
    { id: 'shake', name: 'Shake', note: 'Every blur wave shakes the whole screen' },
    { id: 'cost', name: 'Receipt', note: 'Tuition burned, counted live' },
    { id: 'voice', name: 'Voice', note: 'Your Mac starts talking to you' },
    { id: 'notify', name: 'Notifications', note: 'A banner every 10 seconds' },
    { id: 'penalty', name: 'Penalty', note: 'Each phone second adds 2 to studying' },
    { id: 'snitch', name: 'Snitch', note: 'Texting your study group' },
    { id: 'siren', name: 'Siren', note: 'Siren, volume forced up' },
    { id: 'confess', name: 'Confession', note: 'Type it to make the popup leave (once)' },
    { id: 'deposit', name: 'Deposit', note: '-$1 now and every minute until your $5 is gone' },
  ].map((step) => Object.freeze(step)),
);

export const MAX_LEVEL = LADDER.length - 1;

/**
 * @param {string} id
 * @returns {number}
 */
export function levelIndexOf(id) {
  const index = LADDER.findIndex((step) => step.id === id);
  if (index === -1) throw new Error(`Unknown ladder step: ${id}`);
  return index;
}

/**
 * @param {number} pressureMs accumulated phone pressure
 * @returns {number} ladder index, clamped to the ladder
 */
export function levelForPressure(pressureMs) {
  const raw = Math.floor(Math.max(0, pressureMs) / LEVEL_MS);
  return Math.min(MAX_LEVEL, raw);
}

const STEP = Object.freeze({
  pulse: levelIndexOf('pulse'),
  tick: levelIndexOf('tick'),
  blur: levelIndexOf('blur'),
  shake: levelIndexOf('shake'),
});

/** Screen vibration in points: starts violent, gets worse, stays inside the overlay's 60-point bleed. */
const SHAKE_START_PT = 18;
const SHAKE_STEP_PT = 3;
const SHAKE_MAX_PT = 36;

/** Steps past the one that switched an effect on, or -1 when it is not on yet. */
const stepsPast = (level, start) => (level >= start ? level - start : -1);

/**
 * How hard each continuous effect hits at a given level. Level -1 means off the phone.
 * The pulse period never drops below 1.2 s, far under the 3 flashes/second seizure threshold.
 * @param {number} level
 */
export function intensity(level) {
  const pulse = stepsPast(level, STEP.pulse);
  const tick = stepsPast(level, STEP.tick);
  const blur = stepsPast(level, STEP.blur);
  const shake = stepsPast(level, STEP.shake);
  const shakeAmp = shake < 0 ? 0 : Math.min(SHAKE_MAX_PT, SHAKE_START_PT + SHAKE_STEP_PT * shake);
  return Object.freeze({
    pulseAlpha: pulse < 0 ? 0 : Math.min(0.42, 0.16 + 0.026 * pulse),
    pulsePeriodMs: pulse < 0 ? null : Math.max(1200, 3000 - 180 * pulse),
    blur: blur < 0 ? 0 : Math.min(1, 0.85 + 0.05 * blur),
    shakeAmp,
    shake: shakeAmp > 0,
    tickIntervalMs: tick < 0 ? null : Math.max(280, Math.round(1000 * 0.85 ** tick)),
  });
}
