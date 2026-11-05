/**
 * @param {number} ms
 * @returns {string} m:ss, or h:mm:ss past an hour
 */
export function clock(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Duration written for the speech synthesizer.
 * @param {number} ms
 * @returns {string}
 */
export function spokenDuration(ms) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return plural(seconds, 'second');
  if (seconds === 0) return plural(minutes, 'minute');
  return `${plural(minutes, 'minute')} ${plural(seconds, 'second')}`;
}

/**
 * @param {number} dollars
 * @returns {string}
 */
export function money(dollars) {
  return `$${Math.max(0, dollars).toFixed(2)}`;
}
