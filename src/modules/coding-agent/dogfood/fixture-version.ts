/**
 * The two constants a benchmark fixture is identified by.
 *
 * ## Why these live alone in their own file
 *
 * They were in `fixtures.ts`, which is where they belong conceptually — and
 * that made a cycle the moment Sprint 0055 added calibration fixtures in a
 * second module. `fixtures.ts` has to list them, and they have to be
 * `BenchmarkFixture`s, so the two modules reference each other.
 *
 * A type-only reference is erased and costs nothing. A *value* reference is
 * not: whichever module the bundler enters first evaluates while the other is
 * still initialising, and reads `undefined`. The failure is direction-dependent,
 * which is the worst kind — the unit suite entered through `calibration.ts` and
 * passed, and the production build entered through `fixtures.ts` and threw
 * `Cannot access 'j' before initialization` from a page it had no obvious
 * connection to.
 *
 * Moving the one shared *value* out breaks the cycle at the root rather than
 * deferring it: both modules now depend on this one, and this one depends on
 * nothing.
 */

export const BENCHMARK_FIXTURE_VERSION = "dogfood-fixture.v1" as const;

/**
 * The namespace that separates a fixture step from a planner step.
 *
 * A real step id is `${order}-${changeKind}-${slug(title)}`, produced
 * deterministically by the Planner's own key builder, so it always begins with
 * a digit and can never begin with this prefix. That is what lets the durable
 * execution path recognise a fixture-backed step by its key alone, without a
 * lookup that could be confused by a customer's data.
 *
 * ## Why the separator is `--` and not `:`
 *
 * Because a step key is a **URL path segment**. The first version of this used
 * a colon, and the internal dogfood page answered "that step could not be
 * found" for a fixture that resolved perfectly in every test: the browser sends
 * `dogfood-fixture%3Alow-ui-primary-cta`, the page received that string, and the
 * prefix check failed against the escape sequence.
 *
 * The fix is a key that never needs escaping rather than a `decodeURIComponent`
 * somewhere on the read path — one that would have to be repeated at every
 * boundary the key crosses, and forgotten at one of them.
 */
export const BENCHMARK_STEP_PREFIX = "dogfood-fixture--" as const;
