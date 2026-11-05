/**
 * Pure planning for the Mac-wide effects. `planEffects` decides which one-shot actions are due
 * (tick, speak, notify, siren, volume); `overlayFrame` describes what the native overlay draws.
 * Executing them is mac.js and overlay.js's job.
 */
import { intensity, levelIndexOf } from './ladder.js';
import { clock, money } from './format.js';
import { voiceLine, notifyLine, snitchMessage } from './lines.js';

export const VOICE_EVERY_MS = 15_000;
export const NOTIFY_EVERY_MS = 10_000;

/** Output volume (0-100) forced while sound is part of the punishment. */
export const VOLUME_FLOOR = Object.freeze({ tick: 35, siren: 70 });

/** While a floor is on, push it again this often in case it was turned down or muted. */
export const VOLUME_REASSERT_MS = 5_000;

const LEVEL = Object.freeze({
  cost: levelIndexOf('cost'),
  voice: levelIndexOf('voice'),
  notify: levelIndexOf('notify'),
  penalty: levelIndexOf('penalty'),
  siren: levelIndexOf('siren'),
});

export function createPlan() {
  return Object.freeze({
    lastTickAt: null,
    lastVoiceAt: null,
    lastNotifyAt: null,
    voiceIndex: 0,
    notifyIndex: 0,
    siren: false,
    volumeFloor: null,
    lastVolumeAt: null,
  });
}

const isActive = (snap) => snap.status === 'running' && snap.phone.onPhone;
const isDue = (last, every, now) => last === null || now - last >= every;

/**
 * A repeating action that runs while `on`, on its own interval, and restarts immediately next time.
 * @returns {{ fire: boolean, last: number | null }}
 */
function repeating(on, last, every, now) {
  if (!on) return { fire: false, last: null };
  return isDue(last, every, now) ? { fire: true, last: now } : { fire: false, last };
}

/**
 * @param {ReturnType<typeof createPlan>} plan
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 * @param {number} now real ms
 * @returns {{ plan: ReturnType<typeof createPlan>, actions: Array<Record<string, unknown>> }}
 */
export function planEffects(plan, snap, now) {
  const active = isActive(snap);
  const level = active ? snap.phone.level : -1;
  const fx = intensity(level);

  const tick = repeating(fx.tickIntervalMs !== null, plan.lastTickAt, fx.tickIntervalMs, now);
  const voice = repeating(level >= LEVEL.voice, plan.lastVoiceAt, VOICE_EVERY_MS, now);
  const notify = repeating(level >= LEVEL.notify, plan.lastNotifyAt, NOTIFY_EVERY_MS, now);
  const siren = level >= LEVEL.siren;
  const volumeFloor = siren ? VOLUME_FLOOR.siren : fx.tickIntervalMs !== null ? VOLUME_FLOOR.tick : null;
  const reassert = volumeFloor !== null && isDue(plan.lastVolumeAt, VOLUME_REASSERT_MS, now);
  const pushVolume = volumeFloor !== plan.volumeFloor || reassert;

  // Siren first: stopping it is instant, while restoring the volume takes a moment.
  const actions = [
    ...(siren !== plan.siren ? [{ type: 'siren', on: siren }] : []),
    ...(pushVolume ? [{ type: 'volume', floor: volumeFloor }] : []),
    ...(tick.fire ? [{ type: 'tick' }] : []),
    ...(voice.fire ? [{ type: 'say', text: voiceLine(plan.voiceIndex, snap) }] : []),
    ...(notify.fire ? [{ type: 'notify', ...notifyLine(plan.notifyIndex, snap) }] : []),
  ];

  return {
    actions,
    plan: Object.freeze({
      lastTickAt: tick.last,
      lastVoiceAt: voice.last,
      lastNotifyAt: notify.last,
      voiceIndex: plan.voiceIndex + (voice.fire ? 1 : 0),
      notifyIndex: plan.notifyIndex + (notify.fire ? 1 : 0),
      siren,
      volumeFloor,
      lastVolumeAt: volumeFloor === null ? null : pushVolume ? now : plan.lastVolumeAt,
    }),
  };
}

const INACTIVE_FRAME = Object.freeze({
  t: 'frame',
  active: false,
  phoneText: null,
  levelNumber: null,
  levelCount: null,
  levelName: null,
  costText: null,
  penaltyText: null,
  pulseAlpha: 0,
  pulsePeriodMs: null,
  dim: 0,
  blur: 0,
  shake: false,
  snitchPhase: null,
  snitchSeconds: null,
  snitchMessage: null,
  confession: null,
});

/**
 * What the native overlay should draw right now. Flat on purpose so Swift can decode it directly.
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 */
export function overlayFrame(snap) {
  if (!isActive(snap)) return INACTIVE_FRAME;
  const { level } = snap.phone;
  const fx = intensity(level);
  return Object.freeze({
    ...INACTIVE_FRAME,
    active: true,
    phoneText: clock(snap.phone.stintMs),
    levelNumber: level + 1,
    levelCount: snap.phone.maxLevel + 1,
    levelName: snap.phone.levelName,
    costText: level >= LEVEL.cost ? `${money(snap.cost)} of tuition` : null,
    penaltyText: level >= LEVEL.penalty ? `+${clock(snap.study.penaltyMs)} added to studying` : null,
    pulseAlpha: fx.pulseAlpha,
    pulsePeriodMs: fx.pulsePeriodMs,
    dim: fx.dim,
    blur: fx.blur,
    shake: fx.shake,
    snitchPhase: snap.snitch?.phase ?? null,
    snitchSeconds: snap.snitch?.phase === 'countdown' ? snap.snitch.secondsLeft : null,
    snitchMessage: snap.snitch ? snitchMessage(snap) : null,
    confession: snap.confession.required ? snap.confession.phrase : null,
  });
}
