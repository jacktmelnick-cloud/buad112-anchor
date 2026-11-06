/**
 * Saves the session to disk so closing the tab, or restarting the server, does not end it.
 * The file is treated as untrusted on load: every field is re-validated and rebuilt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createIdle } from './engine.js';
import { parseStart, parseLocation } from './validate.js';
import { SNITCH_COUNTDOWN_MS } from './config.js';

const SAVE_EVERY_MS = 1000;
const STATUSES = new Set(['idle', 'running', 'done']);
const COUNTERS = Object.freeze([
  'studyElapsedMs',
  'studyTargetMs',
  'penaltyMs',
  'phoneMs',
  'stintMs',
  'pressureMs',
  'pickups',
  'maxLevel',
  'confessedUntil',
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const finiteOrNull = (v) => (Number.isFinite(v) ? v : null);

function loadFix(value) {
  if (!isObject(value)) return null;
  const parsed = parseLocation(value);
  if (!parsed.ok) return null;
  return Number.isFinite(value.at) ? { ...parsed.value, at: value.at } : parsed.value;
}

/** The countdown is stored as on-phone time, so it resumes where it was. Older wall-clock saves restart it. */
function loadSnitch(snitch) {
  const elapsed = snitch?.elapsedMs;
  const elapsedMs = Number.isFinite(elapsed) && elapsed >= 0 ? Math.min(elapsed, SNITCH_COUNTDOWN_MS) : null;
  return { elapsedMs, sentAt: finiteOrNull(snitch?.sentAt) };
}

/**
 * Rebuild a session from parsed JSON, or return null if anything is off.
 * Presenter settings (demo speed, simulated distance) never survive a restart.
 */
export function sanitizeSession(raw, now) {
  if (!isObject(raw) || !STATUSES.has(raw.status)) return null;
  if (!COUNTERS.every((key) => Number.isFinite(raw[key]) && raw[key] >= 0)) return null;

  let config = null;
  if (raw.status !== 'idle') {
    const parsed = parseStart(raw.config);
    if (!parsed.ok) return null;
    config = parsed.value;
  }

  const running = raw.status === 'running';
  const onPhone = running && raw.onPhone === true;
  const counters = Object.fromEntries(COUNTERS.map((key) => [key, raw[key]]));
  // Added after the first release; older saves don't have it.
  const awayMs = Number.isFinite(raw.awayMs) && raw.awayMs >= 0 ? raw.awayMs : 0;
  // The punishment clock never runs ahead of the visible timer (older versions could save it that way).
  const pressureMs = Math.min(raw.pressureMs, raw.stintMs);
  const location = isObject(raw.location) ? raw.location : {};

  return {
    ...createIdle(1),
    ...counters,
    pressureMs,
    awayMs,
    status: raw.status,
    config,
    startedAt: finiteOrNull(raw.startedAt),
    endedAt: finiteOrNull(raw.endedAt),
    lastTickAt: now,
    onPhone,
    endedEarly: raw.endedEarly === true,
    location: { anchor: loadFix(location.anchor), current: loadFix(location.current), simulatedM: null },
    snitch: loadSnitch(raw.snitch),
    pickupCounted: raw.pickupCounted === true,
  };
}

/**
 * @param {string} file
 * @param {ReturnType<typeof import('./log.js').createLogger>} log
 */
export function createStore(file, log) {
  let pending = null;
  let lastWrittenAt = 0;
  let lastJson = '';

  function write(state) {
    const json = JSON.stringify(state);
    if (json === lastJson) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, json, { mode: 0o600 });
      fs.renameSync(tmp, file);
      lastJson = json;
      lastWrittenAt = Date.now();
    } catch (error) {
      log.error('Could not save the session', error);
    }
  }

  return Object.freeze({
    /**
     * @param {number} now the time the server resumes; time spent with the server down is not counted
     */
    load(now) {
      try {
        return sanitizeSession(JSON.parse(fs.readFileSync(file, 'utf8')), now);
      } catch (error) {
        if (error.code !== 'ENOENT') log.error('Ignoring an unreadable saved session', error);
        return null;
      }
    },

    save(state) {
      pending = state;
      if (Date.now() - lastWrittenAt >= SAVE_EVERY_MS) write(state);
    },

    flush() {
      if (pending) write(pending);
    },
  });
}
