# UI-8 — Account Dashboard Reference Fidelity

**Status:** Implemented on branch, browser dogfood pending. **No backend change** — no migration,
schema, provider, AI call, database read or billable work was added.

## Problem

CORE-6 established the correct account information architecture and data boundaries, but the first
visual pass overcorrected for density. The result was calm and honest, yet it read as a collection
of generic panels rather than a finished SaaS command center. The supplied visual reference made
the missing hierarchy concrete: a persistent icon rail, one large business-signal object, one
horizontal next-move band, richer product cards and a deliberate connect surface.

The existing Space Grotesk face amplified the problem. Its recognisable geometry gave short labels
and headings a friendly, hand-built character where the product needed a neutral operating-system
voice.

## What changed

- The interface stack is now `Inter → SF Pro → Segoe UI Variable → system UI`. It makes no network
  request and produces no font-loading shift. JetBrains Mono remains self-hosted for actual
  technical output such as SHAs and branches; dashboard scores, statuses and timestamps use the UI
  face.
- The account rail is wider, gains a coherent icon set and a stronger active state. Its identity
  block is now the disclosure control for Profile, Settings, Billing and Sign out, so the rail is
  compact until those destinations are needed.
- Settings is a real account hub rather than a dead menu row. It routes to the existing profile,
  GitHub installation and billing controls without inventing preferences or new persisted state.
- Business Signal becomes one full-width hero: score ring, deterministic interpretation, named
  product, fixed-scale trend and audit dates in one visual object.
- Next Move becomes the horizontal action band from the reference, with one icon, one explanation,
  the engine's real impact/effort ratings and one route into the Action Plan.
- Product cards regain the three facts the reference needs for comparison — signal, next move and
  last analysis — while retaining exactly one action.
- Connecting another product becomes a full-width closing call-to-action instead of a small button
  competing with the products heading.
- The design-system radius is tightened and contained actions use navigation corners. Pills are
  reserved for compact statuses and ratings.

## What did not change

The reference is visual evidence, not domain authority.

- There is still no account-wide score. The hero names the attention-first product; averaging
  incomparable product audits would invent a number no audit produced.
- There is no “Last 7 days” control. Audits do not run on a seven-day series and no date-filtered
  read exists, so the control would promise data behaviour the product does not have.
- There is no “43% of users drop off” sentence. Vibe has no analytics source for that number; the
  validated Move problem remains the evidence-backed explanation.
- Missing evidence never renders as zero, and a scoring-contract change still breaks the trend.
- The dashboard still uses the same constant-cost read model. No per-project read was introduced.

## Verification

- TypeScript: clean after regenerating route types.
- ESLint: zero errors; the repository's existing warnings remain unchanged.
- Unit suite: 6,118 tests across 339 files, all green.
- Targeted dashboard, score-series, sparkline and identity tests: green.
- Production build: the normal Turbopack build remained in “Creating an optimized production
  build” for more than five minutes without output and was stopped. A diagnostic Webpack build
  reached a pre-existing `node:crypto` import in `founder-intent.ts` that its loader cannot handle.
  Type generation and TypeScript compilation are clean; this record does not call the production
  build green.
- Browser dogfood: pending. Repository policy prevents starting branch code outside the approved
  isolated runtime, so the final visual comparison must happen through a safe preview.
