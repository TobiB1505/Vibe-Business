# The Move that asked for a page the product already had

**Recorded 2026-09-02, after the work.** The first successful agent run since
21 August did not build what its step demanded — and that was the right
outcome. The defect is three layers upstream, in what Vibe saw when it looked
at the site. No ADR: nothing new is decided, a detection gap is closed.

## What happened

Run `c462c083` was handed step 2 of *"Make pricing and checkout reachable"*:

> "A public page exists showing the confirmed plans and prices with a working
> purchase/subscribe call to action, **where none was previously observed**."

The premise was false. At `main` @ `37f6161` the product already had all of it:
`src/app/page.tsx:421` carries a `#pricing` section backed by `listPlans()`,
showing €0 / €19 / €49 out of `src/modules/billing/catalog.ts` — exactly the
prices step 1 had approved — with feature lists and call-to-action buttons.
`marketing-shell.tsx` links it from the nav. `/app/billing` holds `StartPlanForm`
and `startPlanCheckoutAction`.

The agent found that, declined to rebuild it, and changed **seven lines**: a paid
plan's button now carries `?next=/app/billing` through signup. Under a false
task, that is the behaviour to want — it is `verifyCandidateChange` and the
policy that stop a run from doing damage, but nothing stops a run doing
*pointless* work except the agent declining to.

## The snapshot contradicted itself

Live analysis `e9b2c0b9`, taken 44 seconds before the run, `completeness: complete`:

| | |
|---|---|
| `pricing.observedPricePoints` | €0, €19, €49 — **all three found on `/`** |
| `productSurfaces.pricing` | `detected: false`, `evidence: []`, `confidence: **high**` |

Two halves of one crawl of one page, disagreeing.

## Why the classifier was blind

`classifier.ts` detects a surface three ways, and an anchor section defeats all three:

1. **Path** — `/^\/(?:pricing|plans?|preise|tarife|upgrade)(?:\/|$)/` needs a path.
   The prices live at `/#pricing`, a fragment on `/`.
2. **Heading** — tested against h1/h2 only. The section's h2 reads *"Start free.
   Add capacity when the work grows."* Neither "pricing" nor "plans". The words
   "Simple plans" are in a `<span>`, which is what `MonoLabel` renders.
3. **Link inference** — reads `discoveredPaths`, and `url.ts` discards fragments
   (`url.ts:186` rejects a bare `#…`, `:137`/`:203` clear `url.hash`). `/#pricing`
   normalises to `/`.

Then `buildProductSurfaces` scores it
`fetchedSurfaces.has(id) ? "high" : detected ? "medium" : "high"` — an undetected
surface gets **high** confidence. High confidence in an absence that was never
detectable.

From there it runs straight: `product-understanding/deterministic.ts:445` reads
only the surface flag, so the conclusion is *"Vibe could not identify a pricing
path in the sources it read"* → audit → Move → step → a paid agent run.

The three prices did reach the model, worded *"Seen on your page, **not stated as
a price** — €19"*. That downgrade is deliberate and its docblock argues for it
well; here it was the last amplifier in a chain that started three layers earlier,
not the cause.

## What was fixed

| | |
|---|---|
| `classifier.ts` | `classifyInPageAnchor` — a same-page anchor's fragment is tested as a path, its label as text. `PageClassification` gains `sectionSurfaces`, kept apart from `surfaces` |
| `signals.ts` | section surfaces join `linkOnlySurfaces`, so they read `detected: true, confidence: "medium"`. `AggregatedSurfaces` now exposes `fetchedSurfaces` |
| `analyzer.ts` | `pricingPageReached` derives from `fetchedSurfaces`, not from the merged `detected` flag |
| `analyzer.ts` | `reconcilePricingConfidence` — the contradiction guard |

**No schema change, no migration.** `nav_label` and `link_text` were already in
`LiveEvidence`.

### The pre-existing bug the fix had to uncover first

`pricingPageReached` was derived from `detected`, and `detected` has always
included link-only inference. So a site that merely *linked* to `/pricing`
without it being crawled already reported that Vibe had **read** the page — which
`business-audit/evidence.ts:466` turns into *"Your pricing page was read and
states no machine-readable price"*, a sentence about a document nobody opened.
Teaching the classifier to see sections would have fired that more often, so
decoupling it was a precondition, not a tidy-up. Its test is red against the
previous commit.

### Why the guard lowers confidence instead of flipping the answer

`detected: false` remains the honest answer to what the detector asks: no pricing
*surface* was identified. Flipping it would be the opposite lie and would make
`pricingPageReached` claim a page was read. What is not honest is the certainty —
so the price finding is attached as evidence and confidence drops to `low`, which
is where a person reading the snapshot sees the gap one layer from its cause
rather than four layers away as somebody's wrong Move.

Anchor sections are handled properly upstream. The guard is the net under the
next shape nobody anticipated.

## What was true in the Move, separated out

Not all of it was wrong, and the parts that were right are why this is a detection
gap rather than a hallucination:

- **True:** there is no `/pricing` route, and no subscribe/purchase CTA on the
  public site — the buttons read "Start with Builder" and classify as
  `get_started`, so `pricingCtaPresent: false` stands.
- **False:** "no visitor on the public site … can see a price".
- **Self-contradictory:** "a billing route (/app/billing) already exists in your
  codebase … and no billing area observed anywhere Vibe checked", in one sentence.

## The prepared change was not approved

`0cfd98e1` passed validation — install, typecheck, test and build all green in an
isolated VM — and was still discarded. Not for the diff, which is correct, but for
its commit message: `feat(marketing): build a public pricing page for the confirmed
plans`, over a commit that builds no pricing page. Merging it would write a false
claim into the history permanently.

Its one genuine line is carried here by hand, under a message that says what it
does, with the landing contract test asserting it. The agent's comment rewrite is
not carried: the old comment was stale, but the replacement said `/#pricing`
*"now"* points at a real catalog-backed section — crediting this change with work
that predated it. The comment is corrected here without the "now".

The branch `vibe/agent-74526cad28e8` is left standing (rule 71).

## Verification

420 test files / **7,298 unit tests**, typecheck, lint and build clean. Red before
green on all four new analyzer cases, including the pre-existing
`pricingPageReached` defect.

**Not measured, and it matters:** the stored analysis `e9b2c0b9`, the audit
`f425d3dd` and the Move built from them are unchanged and still wrong. This fix
changes what *future* analyses see. A rescan costs Credits, so the founder starts
it (rule 60) — and the proof is `productSurfaces.pricing` in the next snapshot.
