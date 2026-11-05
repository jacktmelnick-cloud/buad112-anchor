/** What the Mac says out loud and puts in notifications. Blunt about the phone, never cruel. */
import { spokenDuration, clock, money } from './format.js';
import { levelIndexOf } from './ladder.js';

const PENALTY_LEVEL = levelIndexOf('penalty');

/**
 * @param {number} index rotation counter
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 * @returns {string}
 */
export function voiceLine(index, snap) {
  const t = spokenDuration(snap.phone.stintMs);
  const lines = [
    `${t} on your phone. Your exam is not on TikTok.`,
    `${t}. Your notes miss you.`,
    `Still scrolling. ${t}. Put it down.`,
    `That is ${money(snap.cost)} of tuition, gone.`,
    `The phone will still be there in ${spokenDuration(snap.study.remainingMs)}. Put it down.`,
    ...(snap.phone.level >= PENALTY_LEVEL ? ['Every second now adds two to your study timer.'] : []),
  ];
  return lines[index % lines.length];
}

/**
 * @param {number} index rotation counter
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 * @returns {{ title: string, body: string }}
 */
export function notifyLine(index, snap) {
  const t = clock(snap.phone.stintMs);
  const step = `Step ${snap.phone.level + 1} of ${snap.phone.maxLevel + 1}: ${snap.phone.levelName}`;
  const lines = [
    { title: 'Still on your phone', body: `${t} and counting. ${step}.` },
    { title: 'Anchor', body: `${money(snap.cost)} of tuition so far. Put it down.` },
    { title: 'Your study timer misses you', body: `${clock(snap.study.remainingMs)} left. You are at ${t} on your phone.` },
  ];
  return lines[index % lines.length];
}

/**
 * The fake text the snitch step "sends".
 * @param {ReturnType<typeof import('./engine.js').snapshot>} snap
 * @returns {string}
 */
export function snitchMessage(snap) {
  return `I've been on my phone for ${clock(snap.phone.stintMs)} instead of studying for ${snap.config?.courseName ?? 'class'}. Roast me.`;
}
