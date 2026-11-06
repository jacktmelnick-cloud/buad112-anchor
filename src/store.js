/**
 * Saves the session to disk so closing the tab, or restarting the server, does not end it.
 * The file is treated as untrusted on load: every field is re-validated and rebuilt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createIdle } from './engine.js';
import { parseStart, parseLocation } from './validate.js';

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

function loadSnitch(snitch, running, onPhone, now) {
  const startedAt = finiteOrNull(snitch?.startedAt);
  const sentAt = finiteOrNull(snitch?.sentAt);
  // A countdown that was mid-way when the server stopped starts over instead of firing instantly.
  const restart = running && onPhone && startedAt !== null && sentAt === null;
  return { startedAt: restart ? now : sentAt === null ? null : startedAt, sentAt };
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
  const optional = (key) => (Number.isFinite(raw[key]) && raw[key] >= 0 ? raw[key] : 0);
  const awayMs = optional('awayMs');
  const offMs = optional('offMs');
  // Saves from the gradual-cooldown version can hold a punishment clock ahead of the visible timer.
  const fromOldVersion = !('offMs' in raw);
  const pressureMs = fromOldVersion ? Math.min(raw.pressureMs, raw.stintMs) : raw.pressureMs;
  const inPickup = typeof raw.inPickup === 'boolean' ? raw.inPickup : pressureMs > 0 || raw.stintMs > 0;
  const location = isObject(raw.location) ? raw.location : {};

  return {
    ...createIdle(1),
    ...counters,
    pressureMs,
    awayMs,
    offMs,
    inPickup,
    status: raw.status,
    config,
    startedAt: finiteOrNull(raw.startedAt),
    endedAt: finiteOrNull(raw.endedAt),
    lastTickAt: now,
    onPhone,
    endedEarly: raw.endedEarly === true,
    location: { anchor: loadFix(location.anchor), current: loadFix(location.current), simulatedM: null },
    snitch: loadSnitch(raw.snitch, running, onPhone, now),
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
