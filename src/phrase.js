/**
 * Lowercase, drop punctuation, collapse whitespace, so a confession matches however it is typed.
 * @param {string} text
 * @returns {string}
 */
export function normalizePhrase(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
