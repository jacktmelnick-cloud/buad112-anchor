/**
 * Phone mode: what the iOS Shortcut should do to the phone right now. Pure; the Shortcut applies it
 * (Color Filters, Set Brightness, Open URL) and docs/shortcuts.md shows how.
 */
import { ladderFor } from './ladder.js';

/** Seconds you wait on the gate before you can go back to the app, by step. Longer every step. */
export const GATE_SECONDS = Object.freeze([10, 15, 20, 30, 40, 60]);

/** After the gate, reopening apps doesn't bounce you for this long. Shorter every step. */
export const PASS_SECONDS = Object.freeze([90, 75, 60, 45, 30, 15]);

/** Brightness (0-1) forced from the dim step on. */
export const DIM_BRIGHTNESS = 0.15;

/** What the phone goes back to when the punishment lifts. */
export const RESTORE_BRIGHTNESS = 0.6;

const at = (list, level) => list[Math.min(level, list.length - 1)];

/** Nothing on: off the phone's ladder, away from the anchor, or no session. */
const OFF = Object.freeze({
  active: false,
  grayscale: false,
  brightness: RESTORE_BRIGHTNESS,
  brightnessPercent: RESTORE_BRIGHTNESS * 100,
  dim: false,
  gate: false,
  gateSeconds: 0,
  confess: false,
});

/**
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 * @param {{ passUntil: number | null }} pass
 * @param {number} now
 */
export function phoneEffects(snap, { passUntil }, now) {
  if (snap.status !== 'running' || snap.away) return { ...OFF, inZone: !snap.away && snap.status === 'running' };
  const ladder = ladderFor(snap.quiet === true, Boolean(snap.deposit), 'phone');
  const level = snap.phone.level;
  const dim = ladder.reached(level, 'dim');
  const passed = passUntil !== null && now < passUntil;
  return {
    active: true,
    inZone: true,
    level,
    levelName: snap.phone.levelName,
    grayscale: ladder.reached(level, 'gray'),
    dim,
    brightness: dim ? DIM_BRIGHTNESS : RESTORE_BRIGHTNESS,
    // Shortcuts' Set Brightness takes a percentage.
    brightnessPercent: Math.round((dim ? DIM_BRIGHTNESS : RESTORE_BRIGHTNESS) * 100),
    // The confession can't be waited out: it gates every open until it's typed, pass or not.
    gate: !passed || snap.confession.owed,
    gateSeconds: at(GATE_SECONDS, level),
    passSeconds: at(PASS_SECONDS, level),
    confess: snap.confession.owed,
  };
}
