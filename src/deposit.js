/**
 * The deposit's exponential loss schedule.
 *
 * Every option drains on the same curve: each minute takes r times the minute before, with
 * r = (sqrt(17) - 1) / 2 ≈ 1.5616, the ratio that splits $5 into exactly $1.00, $1.56, $2.44.
 * Bigger deposits burn for more minutes, so a bigger stake costs more at every minute and for longer.
 * For a deposit D spread over n minutes, the first bite is a = D (r - 1) / (r^n - 1), so the bites
 * a, ar, ar², ... add up to exactly D. Bites are rounded to cents and the last one absorbs the rounding.
 *
 *   $5   over 3 min: 1.00  1.56  2.44
 *   $10  over 4 min: 1.14  1.77  2.77  4.32
 *   $25  over 5 min: 1.69  2.65  4.13  6.45  10.08
 *   $50  over 6 min: 2.08  3.25  5.07  7.92  12.37  19.31
 *   $100 over 7 min: 2.59  4.05  6.33  9.88  15.43  24.09  37.63
 */

export const DEPOSIT_OPTIONS = Object.freeze([5, 10, 25, 50, 100]);

export const DEPOSIT_LOSS_RATIO = (Math.sqrt(17) - 1) / 2;

/** Minutes of bites until each deposit is empty. */
const MINUTES_TO_EMPTY = Object.freeze({ 5: 3, 10: 4, 25: 5, 50: 6, 100: 7 });

const cents = (dollars) => Math.round(dollars * 100) / 100;

/**
 * @param {number} total one of DEPOSIT_OPTIONS (anything else drains over 3 minutes)
 * @returns {ReadonlyArray<number>} dollars taken at the deposit step and each minute after
 */
export function depositSchedule(total) {
  const minutes = MINUTES_TO_EMPTY[total] ?? 3;
  const r = DEPOSIT_LOSS_RATIO;
  const first = (total * (r - 1)) / (r ** minutes - 1);
  const leading = Array.from({ length: minutes - 1 }, (_, i) => cents(first * r ** i));
  const last = cents(total - leading.reduce((a, b) => a + b, 0));
  return Object.freeze([...leading, last]);
}

/**
 * @param {number} total
 * @param {number} bites how many bites have been taken so far
 * @returns {number} dollars lost, never more than the deposit
 */
export function depositLostAfter(total, bites) {
  const taken = depositSchedule(total).slice(0, Math.max(0, bites));
  return Math.min(total, cents(taken.reduce((a, b) => a + b, 0)));
}
