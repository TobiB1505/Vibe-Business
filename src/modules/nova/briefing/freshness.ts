/**
 * How old a thing is, in the words a person would use.
 *
 * ## The question this file exists to answer
 *
 * "Does the briefing update itself? Because if it only changes when *I* change
 * something, then 'your audit is from five days ago' can never appear — the
 * audit did not move, the clock did."
 *
 * That is exactly right, and it is the trap this module is here to avoid. The
 * briefing itself is derived on every read and is therefore always current —
 * it is a query, not a stored value. What could go stale is the *one sentence*
 * Nova writes about it, because writing that sentence costs money and is
 * therefore reused against an identity. If nothing in the identity moves with
 * the clock, a sentence written on Monday is still on screen on Friday saying
 * the same thing about a week that has since passed.
 *
 * So the identity carries a **bucket**, not an age. Days pass, the bucket
 * eventually flips, the identity moves, and Nova writes about the new
 * situation without anything else having happened.
 *
 * ## Why a bucket rather than the number of days
 *
 * Because the number would move every day, and a new sentence every day is a
 * bill for saying the same thing in different words. The buckets below are how
 * people actually speak about age — "today", "a few days ago", "about a week",
 * "a few weeks", "months" — and each crossing is a genuine change in what is
 * worth saying, not a tick.
 *
 * ## The exact number is not lost, it just is not the model's job
 *
 * "Five days" is rendered from the timestamp by the screen, live, every time
 * it is drawn. A template may name a number because a template computes it; a
 * model may not, because a model's sentence is stored and a number in a stored
 * sentence is a lie with a delay on it. That is the same rule `checks.ts`
 * already enforces on every Nova message, applied here to time.
 */

/** The ages that are worth a different sentence, oldest last. */
export const FRESHNESS_BUCKETS = [
  "today",
  "a_few_days",
  "about_a_week",
  "a_few_weeks",
  "months",
] as const;

export type Freshness = (typeof FRESHNESS_BUCKETS)[number];

/** Where each bucket starts, in whole days. Ordered, and checked by test. */
const BUCKET_FLOOR: ReadonlyArray<{ from: number; bucket: Freshness }> = [
  { from: 46, bucket: "months" },
  { from: 11, bucket: "a_few_weeks" },
  { from: 4, bucket: "about_a_week" },
  { from: 1, bucket: "a_few_days" },
  { from: 0, bucket: "today" },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two instants, never negative.
 *
 * A timestamp in the future is a clock disagreement — a server slightly ahead
 * of a database, or a row written during a leap adjustment — and the honest
 * reading of "produced 40 seconds from now" is "just now", not a negative age
 * that would fall out of every bucket.
 */
export function daysBetween(from: string | null, now: Date): number | null {
  if (from === null) return null;

  const then = Date.parse(from);
  if (Number.isNaN(then)) return null;

  return Math.max(0, Math.floor((now.getTime() - then) / MS_PER_DAY));
}

/**
 * The bucket an age falls in, or null when there is no age.
 *
 * Null is a real answer and not a zero: a scan that never ran has no age, and
 * calling that "today" would make the freshest possible reading out of the
 * absence of any reading at all.
 */
export function freshnessOf(producedAt: string | null, now: Date): Freshness | null {
  const days = daysBetween(producedAt, now);
  if (days === null) return null;

  return BUCKET_FLOOR.find((entry) => days >= entry.from)?.bucket ?? "today";
}

/**
 * The bucket, as Vibe's own words.
 *
 * Deterministic text, so the screen can say it with no model and no cost —
 * and so the sentence a model writes has something to agree with rather than
 * a number to invent.
 */
export const FRESHNESS_LABELS: Record<Freshness, string> = {
  today: "today",
  a_few_days: "a few days ago",
  about_a_week: "about a week ago",
  a_few_weeks: "a few weeks ago",
  months: "months ago",
};

/**
 * Whether an age is old enough that Nova should mention it unprompted.
 *
 * The line is drawn at "about a week", and it is a judgment rather than a
 * measurement: below it, age alone says nothing — a scan from Tuesday of a
 * site nobody touched is perfectly good evidence, which is the same argument
 * `analyzer-versions.test.ts` makes about why the *version* is the fact and
 * the age is a proxy.
 *
 * What makes something worth raising before this line is not its age but its
 * **state** — an outdated analyzer, a moved input — and that comes from the
 * provenance chain, which knows the difference. This only decides whether a
 * date is worth a sentence when nothing else is wrong.
 */
export function worthMentioning(freshness: Freshness | null): boolean {
  return freshness === "about_a_week" || freshness === "a_few_weeks" || freshness === "months";
}
