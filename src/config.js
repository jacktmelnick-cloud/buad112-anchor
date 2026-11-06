/** Tunable constants for the session rules. Times are in milliseconds unless named otherwise. */

/** One step up the annoyance ladder per this much time on the phone. */
export const LEVEL_MS = 15_000;

/**
 * Off the phone for this long and the pickup is over: the phone timer and the punishment both reset
 * to zero. Back on sooner and both continue where they were.
 */
export const GRACE_MS = 15_000;

/** Stop stays locked while you are within this many meters of where you started. */
export const RADIUS_M = 50;

/** Study seconds added per phone second once the penalty step is reached. */
export const PENALTY_RATE = 2;

/** Real-time countdown before the fake "texting your study group" message goes out. */
export const SNITCH_COUNTDOWN_MS = 10_000;

/** How long the fake "sent" bubble stays on screen. */
export const SNITCH_SENT_VISIBLE_MS = 8_000;

/** The sentence you have to type at the top step. */
export const CONFESSION_PHRASE = 'I am choosing my phone over my grade';

/** Quiet time a correct confession buys before the popup comes back. */
export const CONFESSION_GRACE_MS = 30_000;

/** A tick gap longer than this (laptop asleep, stalled loop) is treated as a pause, not session time. */
export const MAX_TICK_GAP_MS = 2_000;

/** A location fix older than this when you press start is not trusted as the anchor. */
export const ANCHOR_MAX_AGE_MS = 30_000;

/** GPS margin added to the radius before Stop unlocks: the worse accuracy, capped at this. */
export const MAX_ACCURACY_MARGIN_M = 50;

/** Presenter speeds: 1x is real time, 6x turns each 15 s step into 2.5 s. */
export const DEMO_SPEEDS = Object.freeze([1, 6]);

/**
 * Class minutes in a school year, used to turn yearly tuition into "what one minute of class costs":
 * 15 class hours a week x 15-week semesters x 2 semesters = 450 hours = 27,000 minutes.
 */
export const CLASS_MINUTES_PER_YEAR = 15 * 15 * 2 * 60;

export const DEFAULTS = Object.freeze({
  studyMinutes: 25,
  dollarsPerMinute: 2.5,
  courseName: 'BUAD 112',
});

export const LIMITS = Object.freeze({
  minStudyMinutes: 1,
  maxStudyMinutes: 240,
  maxDollarsPerMinute: 100,
  maxTuitionPerYear: 500_000,
  maxCourseName: 40,
  maxSimulatedM: 500,
  maxConfession: 200,
  maxAccuracyM: 100_000,
});
