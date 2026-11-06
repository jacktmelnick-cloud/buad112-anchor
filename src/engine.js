/**
 * The session rules as pure functions. Every function takes a state and returns a new one;
 * nothing here touches the clock, the disk, or the Mac. `now` is always real wall-clock ms.
 */
import {
  LEVEL_MS,
  RADIUS_M,
  PENALTY_RATE,
  SNITCH_COUNTDOWN_MS,
  SNITCH_SENT_VISIBLE_MS,
  CONFESSION_PHRASE,
  CONFESSION_GRACE_MS,
  MAX_TICK_GAP_MS,
  ANCHOR_MAX_AGE_MS,
  MAX_ACCURACY_MARGIN_M,
  GRACE_MS,
} from './config.js';
import { LADDER, MAX_LEVEL, levelForPressure, levelIndexOf } from './ladder.js';
import { distanceMeters } from './geo.js';
import { normalizePhrase } from './phrase.js';

const PENALTY_LEVEL = levelIndexOf('penalty');
const SNITCH_LEVEL = levelIndexOf('snitch');
const CONFESS_LEVEL = levelIndexOf('confess');

/** The punishment clock stops at the top step; the timer you see keeps counting. */
const PRESSURE_CAP_MS = (MAX_LEVEL + 1) * LEVEL_MS - 1;

const NO_SNITCH = Object.freeze({ startedAt: null, sentAt: null });

const GRADES = Object.freeze([
  [93, 'A'],
  [90, 'A-'],
  [87, 'B+'],
  [83, 'B'],
  [80, 'B-'],
  [77, 'C+'],
  [73, 'C'],
  [70, 'C-'],
  [60, 'D'],
  [0, 'F'],
]);

/**
 * @param {number} [demoSpeed]
 * @param {{ lat: number, lng: number, accuracy: number } | null} [currentFix]
 */
export function createIdle(demoSpeed = 1, currentFix = null) {
  return {
    status: 'idle',
    config: null,
    demoSpeed,
    startedAt: null,
    lastTickAt: null,
    endedAt: null,
    studyElapsedMs: 0,
    studyTargetMs: 0,
    penaltyMs: 0,
    onPhone: false,
    phoneMs: 0,
    stintMs: 0,
    pressureMs: 0,
    pickups: 0,
    maxLevel: 0,
    location: { anchor: null, current: currentFix, simulatedM: null },
    snitch: NO_SNITCH,
    confessedUntil: 0,
    endedEarly: false,
    awayMs: 0,
    offMs: 0,
  };
}

/**
 * @param {ReturnType<typeof createIdle>} state
 * @param {{ studyMinutes: number, dollarsPerMinute: number, courseName: string }} config
 * @param {number} now
 */
export function startSession(state, config, now) {
  if (state.status === 'running') return state;
  const current = state.location.current;
  const fresh = current && Number.isFinite(current.at) && now - current.at <= ANCHOR_MAX_AGE_MS;
  const anchor = fresh ? { lat: current.lat, lng: current.lng, accuracy: current.accuracy } : null;
  return {
    ...createIdle(state.demoSpeed, current),
    status: 'running',
    config: { ...config },
    startedAt: now,
    lastTickAt: now,
    studyTargetMs: config.studyMinutes * 60_000,
    location: { anchor, current, simulatedM: null },
  };
}

function advanceSnitch(snitch, onPhone, level, now) {
  if (snitch.sentAt !== null) return snitch;
  if (!onPhone || level < SNITCH_LEVEL) return snitch.startedAt === null ? snitch : NO_SNITCH;
  if (snitch.startedAt === null) return { startedAt: now, sentAt: null };
  if (now - snitch.startedAt >= SNITCH_COUNTDOWN_MS) return { ...snitch, sentAt: now };
  return snitch;
}

function finish(state, now, endedEarly) {
  return {
    ...state,
    status: 'done',
    onPhone: false,
    endedAt: now,
    endedEarly,
    snitch: state.snitch.sentAt === null ? NO_SNITCH : state.snitch,
  };
}

/**
 * Advance the clocks to `now`. Demo speed scales session time; the snitch countdown stays real.
 * @param {ReturnType<typeof createIdle>} state
 * @param {number} now
 */
export function tick(state, now) {
  if (state.status !== 'running') return state;
  const dt = Math.min(MAX_TICK_GAP_MS, Math.max(0, now - state.lastTickAt)) * state.demoSpeed;
  const away = isAway(state.location);
  // Away from the anchor the phone is just a phone, and the study timer waits for you to come back.
  const counts = state.onPhone && !away;
  const level = levelForPressure(state.pressureMs);
  const added = counts && level >= PENALTY_LEVEL ? dt * PENALTY_RATE : 0;
  // One clock: on the phone it grows; off (or away) it holds through the grace period, then resets.
  const offMs = counts ? 0 : (state.offMs ?? 0) + dt;
  const graceOver = !counts && offMs >= GRACE_MS;
  const pressureMs = counts ? Math.min(PRESSURE_CAP_MS, state.pressureMs + dt) : graceOver ? 0 : state.pressureMs;
  const newLevel = levelForPressure(pressureMs);
  const next = {
    ...state,
    lastTickAt: now,
    studyElapsedMs: away ? state.studyElapsedMs : state.studyElapsedMs + dt,
    awayMs: away ? (state.awayMs ?? 0) + dt : (state.awayMs ?? 0),
    studyTargetMs: state.studyTargetMs + added,
    penaltyMs: state.penaltyMs + added,
    phoneMs: counts ? state.phoneMs + dt : state.phoneMs,
    stintMs: counts ? state.stintMs + dt : graceOver ? 0 : state.stintMs,
    pressureMs,
    offMs,
    maxLevel: counts ? Math.max(state.maxLevel, newLevel) : state.maxLevel,
    snitch: advanceSnitch(state.snitch, counts, newLevel, now),
  };
  return next.studyElapsedMs >= next.studyTargetMs ? finish(next, now, false) : next;
}

/**
 * @param {ReturnType<typeof createIdle>} state
 * @param {boolean} onPhone
 * @param {number} now
 */
export function setPhone(state, onPhone, now) {
  if (state.status !== 'running') return state;
  const current = tick(state, now);
  if (current.status !== 'running' || current.onPhone === onPhone) return current;
  if (onPhone) {
    // Back within the grace period: same pickup, same timer, same step.
    const fresh = current.pressureMs === 0 && current.stintMs === 0;
    const counted = fresh && !isAway(current.location) ? 1 : 0;
    return { ...current, onPhone: true, offMs: 0, pickups: current.pickups + counted };
  }
  const bubbleGone = current.snitch.sentAt === null || now - current.snitch.sentAt >= SNITCH_SENT_VISIBLE_MS;
  return { ...current, onPhone: false, offMs: 0, snitch: bubbleGone ? NO_SNITCH : current.snitch };
}

/**
 * Record a location fix. The first fix of a running session becomes its anchor.
 * @param {ReturnType<typeof createIdle>} state
 * @param {{ lat: number, lng: number, accuracy: number }} fix
 * @param {number} now
 */
export function updateLocation(state, fix, now) {
  const current = { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, at: now };
  const needsAnchor = state.status === 'running' && state.location.anchor === null;
  const anchor = needsAnchor ? { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy } : state.location.anchor;
  return settleAway(state, { ...state, location: { ...state.location, current, anchor } });
}

/**
 * Presenter control: pretend to be this far from the anchor. `null` goes back to real location.
 * @param {ReturnType<typeof createIdle>} state
 * @param {number | null} meters
 */
export function setSimulatedDistance(state, meters) {
  return settleAway(state, { ...state, location: { ...state.location, simulatedM: meters } });
}

/**
 * Crossing the line: walking back in while still on the phone is a fresh pickup that starts escalating;
 * walking out cancels a snitch countdown.
 */
function settleAway(before, after) {
  if (after.status !== 'running') return after;
  const wasAway = isAway(before.location);
  const nowAway = isAway(after.location);
  if (wasAway && !nowAway && after.onPhone) {
    // Away long enough for the grace period to run out means this is a new pickup starting at step 1.
    const fresh = after.pressureMs === 0 && after.stintMs === 0;
    return fresh ? { ...after, offMs: 0, pickups: after.pickups + 1 } : { ...after, offMs: 0 };
  }
  if (!wasAway && nowAway && after.snitch.sentAt === null) return { ...after, snitch: NO_SNITCH };
  return after;
}

/**
 * @param {ReturnType<typeof createIdle>} state
 * @param {number} speed
 */
export function setDemoSpeed(state, speed) {
  return { ...state, demoSpeed: speed };
}

/**
 * @param {ReturnType<typeof createIdle>} state
 * @param {string} text
 * @param {number} now
 */
export function confess(state, text, now) {
  if (state.status !== 'running' || !state.onPhone || isAway(state.location)) return state;
  if (normalizePhrase(text) !== normalizePhrase(CONFESSION_PHRASE)) return state;
  return { ...state, confessedUntil: now + CONFESSION_GRACE_MS };
}

function distanceFromAnchor(location) {
  if (location.simulatedM !== null) return location.simulatedM;
  if (!location.anchor || !location.current) return null;
  return distanceMeters(location.anchor, location.current);
}

/** How far you must be before Stop unlocks: the radius plus a GPS margin when the location is real. */
function unlockDistance(location) {
  if (location.simulatedM !== null || !location.anchor || !location.current) return RADIUS_M;
  const accuracy = Math.max(location.anchor.accuracy ?? 0, location.current.accuracy ?? 0);
  return RADIUS_M + Math.min(MAX_ACCURACY_MARGIN_M, accuracy);
}

/** Clearly past the unlock distance. Unknown location counts as at the anchor. */
function isAway(location) {
  const distance = distanceFromAnchor(location);
  return distance !== null && distance > unlockDistance(location);
}

const canStopAt = (state) => state.status === 'running' && isAway(state.location);

/**
 * End early. Only allowed once you are outside the radius; otherwise the state comes back unchanged.
 * @param {ReturnType<typeof createIdle>} state
 * @param {number} now
 */
export function stopSession(state, now) {
  if (state.status !== 'running') return state;
  const current = tick(state, now);
  if (current.status !== 'running') return current;
  return canStopAt(current) ? finish(current, now, true) : state;
}

/**
 * @param {ReturnType<typeof createIdle>} state
 */
export function resetSession(state) {
  return state.status === 'done' ? createIdle(1, state.location.current) : state;
}

const gradeFor = (score) => GRADES.find(([min]) => score >= min)[1];
const cents = (dollars) => Math.round(dollars * 100) / 100;

function summarize(state) {
  const studied = Math.max(1, state.studyElapsedMs);
  const focused = 1 - Math.min(1, state.phoneMs / studied);
  const completion = state.endedEarly ? Math.min(1, state.studyElapsedMs / state.studyTargetMs) : 1;
  const focusScore = Math.max(0, Math.min(100, Math.round(100 * focused * completion)));
  return {
    focusScore,
    grade: gradeFor(focusScore),
    studiedMs: state.studyElapsedMs,
    targetMs: state.studyTargetMs,
    phoneMs: state.phoneMs,
    pickups: state.pickups,
    penaltyMs: state.penaltyMs,
    cost: cents((state.phoneMs / 60_000) * state.config.dollarsPerMinute),
    maxLevel: state.maxLevel,
    maxLevelName: state.pickups > 0 ? LADDER[state.maxLevel].name : null,
    endedEarly: state.endedEarly,
    awayMs: state.awayMs ?? 0,
    courseName: state.config.courseName,
  };
}

function snitchView(snitch, now) {
  if (snitch.sentAt !== null) return now - snitch.sentAt < SNITCH_SENT_VISIBLE_MS ? { phase: 'sent' } : null;
  if (snitch.startedAt === null) return null;
  const left = Math.max(0, SNITCH_COUNTDOWN_MS - (now - snitch.startedAt));
  return { phase: 'countdown', secondsLeft: Math.ceil(left / 1000) };
}

/**
 * Everything the page, the overlay, and the effects planner need, derived from state.
 * @param {ReturnType<typeof createIdle>} state
 * @param {number} now
 */
export function snapshot(state, now) {
  const level = levelForPressure(state.pressureMs);
  const distance = distanceFromAnchor(state.location);
  const unlockAtM = unlockDistance(state.location);
  const running = state.status === 'running';
  const away = running && isAway(state.location);
  const phoneCounts = state.onPhone && !away;
  const inGrace = running && !phoneCounts && state.pressureMs > 0;
  const rate = state.config?.dollarsPerMinute ?? 0;
  const atTop = level < MAX_LEVEL ? (level + 1) * LEVEL_MS - state.pressureMs : null;
  return {
    status: state.status,
    config: state.config,
    demoSpeed: state.demoSpeed,
    study: {
      elapsedMs: state.studyElapsedMs,
      targetMs: state.studyTargetMs,
      remainingMs: Math.max(0, state.studyTargetMs - state.studyElapsedMs),
      penaltyMs: state.penaltyMs,
    },
    phone: {
      onPhone: state.onPhone,
      stintMs: state.stintMs,
      totalMs: state.phoneMs,
      pickups: state.pickups,
      level,
      levelId: LADDER[level].id,
      levelName: LADDER[level].name,
      restingLevel: inGrace ? level : null,
      graceLeftMs: inGrace ? Math.max(0, GRACE_MS - (state.offMs ?? 0)) / state.demoSpeed : null,
      maxLevel: MAX_LEVEL,
      nextLevelInMs: phoneCounts && atTop !== null ? atTop / state.demoSpeed : null,
    },
    cost: cents((state.phoneMs / 60_000) * rate),
    location: {
      hasAnchor: state.location.anchor !== null,
      distanceM: distance,
      accuracyM: state.location.current?.accuracy ?? null,
      simulated: state.location.simulatedM !== null,
      inside: distance === null || distance <= unlockAtM,
      radiusM: RADIUS_M,
      unlockAtM,
    },
    canStop: canStopAt(state),
    away,
    snitch: running ? snitchView(state.snitch, now) : null,
    confession: {
      required: running && phoneCounts && level >= CONFESS_LEVEL && now >= state.confessedUntil,
      phrase: CONFESSION_PHRASE,
    },
    summary: state.status === 'done' ? summarize(state) : null,
  };
}
