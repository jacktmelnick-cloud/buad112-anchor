/**
 * The deposit's exponential loss schedule. Pure math, shared by the server (what is charged) and the
 * page (what the setup screen promises), so the two can never disagree.
 *
 * Any amount drains on the same curve: each minute takes r times the minute before, with
 * r = (sqrt(17) - 1) / 2 ≈ 1.5616, the ratio that splits $5 into exactly $1.00, $1.56, $2.44.
 * It burns for n = 3 + round(log2(amount / 5)) minutes, clamped to 1-15, so bigger deposits burn longer:
 * $5 → 3, $10 → 4, $25 → 5, $50 → 6, $100 → 7, $1,000 → 11.
 * The first bite is a = D (r - 1) / (r^n - 1), so the bites a, ar, ar², ... add up to exactly D.
 * Bites are rounded to cents and the last one absorbs the rounding.
 */

export const DEPOSIT_LOSS_RATIO = (Math.sqrt(17) - 1) / 2;

/** The most anyone can put down. */
export const DEPOSIT_MAX = 10_000;

const BASE_DOLLARS = 5;
const BASE_MINUTES = 3;
const MIN_MINUTES = 1;
const MAX_MINUTES = 15;

const cents = (dollars) => Math.round(dollars * 100) / 100;

/**
 * @param {number} amount dollars put down (0 = no deposit)
 * @returns {number} minutes of bites until it is empty
 */
export function depositMinutes(amount) {
  if (!(amount > 0)) return 0;
  const minutes = BASE_MINUTES + Math.round(Math.log2(amount / BASE_DOLLARS));
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, minutes));
}

/**
 * @param {number} amount
 * @returns {ReadonlyArray<number>} dollars taken at the deposit step and each minute after
 */
export function depositSchedule(amount) {
  const minutes = depositMinutes(amount);
  if (minutes === 0) return Object.freeze([]);
  const r = DEPOSIT_LOSS_RATIO;
  const first = (amount * (r - 1)) / (r ** minutes - 1);
  const leading = Array.from({ length: minutes - 1 }, (_, i) => cents(first * r ** i));
  const last = cents(amount - leading.reduce((a, b) => a + b, 0));
  return Object.freeze([...leading, last]);
}

/**
 * @param {number} amount
 * @param {number} bites how many bites have been taken so far
 * @returns {number} dollars lost, never more than the deposit
 */
export function depositLostAfter(amount, bites) {
  const taken = depositSchedule(amount).slice(0, Math.max(0, bites));
  return Math.min(amount, cents(taken.reduce((a, b) => a + b, 0)));
}

/**
 * @param {number} amount
 * @returns {boolean} a whole number of cents from $0 to the max
 */
export function isValidDeposit(amount) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return false;
  if (amount < 0 || amount > DEPOSIT_MAX) return false;
  return Math.abs(Math.round(amount * 100) - amount * 100) < 1e-6;
}
