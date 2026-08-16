# Sprint CORE-1 — Product Understanding Layer

## Goal

Build the layer that answers **"what is this product?"**, between the scanners that answer
"what did Vibe observe?" and the audit that answers "what does this mean for the business?".

The product criterion is not that Vibe analysed a lot. It is that a founder reads one
paragraph and thinks *yes — that's my product*.

## Context

Everything before this sprint reasoned from evidence directly. The Business Audit reads two
snapshots plus the founder's typed context and produces five dimension scores; the
Opportunity Engine reads the audit and produces ranked moves. Nothing in between ever
established what the product **is**.

That gap costs twice. It costs the user, who sees Vibe report routes and dependencies and
reasonably concludes it has not understood their work. And it costs every downstream
consumer, which has to re-derive the same understanding from raw evidence each time — the
audit, next moves, and later content, positioning, SEO and copy.

So the durable model becomes:

```
Repository Intelligence  ┐
Live Product Intelligence├─→ PRODUCT UNDERSTANDING → PRODUCT PROFILE → BUSINESS AUDIT → NEXT MOVES → EXECUTION
Deep Scan (optional)     ┘
```

The two collectors stay technically separate, as [ARCHITECTURE.md §3.3](../../ARCHITECTURE.md#33-live-product-analysis-layer)
requires. What is new is the interpretation layer above them.

## Scope

### 1. Brand evidence in both collectors

Brand is the one thing neither snapshot carried, so a section was added to each — answering
a *different* question in each place.

**Repository** (`repository-intelligence/detectors/brand.ts`, analyzer `v2` → `v3`):

- **Assets** from tree paths only. No image is ever downloaded — image extensions are binary
  and `mayFetchContent` refuses them — so an asset claim rests entirely on where a file sits
  and what it is called. A path becomes a logo because it is *named* like one in a place
  logos live; an arbitrary SVG in `/public` stays an arbitrary SVG. A `-mono`/`-white`/`-alt`
  suffix demotes it to `logo_alternate`.
- **Colour and type** from design-token declarations, read from a short named list of
  stylesheet/theme files now fetched for their contents (`globals.css`, `theme.css`,
  `tokens.css`, `tailwind.config.*`, …) at priority 3 — behind every dependency manifest, so
  a repository tight against `maxFileFetches` still gets its stack detected and simply
  reports no brand tokens.

**Live product** (`live-product-intelligence/brand.ts`, analyzer `v1` → `v2`): declared
icons (`rel="icon"`, `apple-touch-icon`), `og:image`, `theme-color`, header images the page
itself labels as its mark, and custom properties from inline critical CSS. Nothing is
fetched, query strings are dropped, and a `<title>` never becomes a product name.

Both analyzer versions are bumped, so existing snapshots correctly stop being reusable
rather than silently reporting an empty brand.

### 2. The Product Profile (`product-profile.v1`)

A persisted, versioned document — not a view model. Two rules shape the whole schema:

- **Every claim carries its provenance.** There is no bare string in the profile.
  `Attributed<T>` pairs a value with a confidence and the sources and evidence ids behind
  it, because "this product is for restaurant owners" means something completely different
  when the founder typed it than when a model inferred it from a landing page.
- **Absence is a first-class value.** `not_found` means Vibe looked in the sources it had
  and saw nothing. It never means the thing does not exist, and it is never rendered as a
  deficiency.

Sections: identity, audience, capabilities, journey, business signals, brand, technical
profile, sources, completeness, limitations.

### 3. What is derived by rule, and what needs a model

Everything answerable by rule **is** answered by rule (`deterministic.ts`): capabilities,
the customer journey, business signals, the technical profile, and all of brand. Rules are
free, identical every run, and better at "does this surface exist?" than inference is.

The model is asked only for the semantic half: what the product is for, who it appears to be
for, what it promises, and how to say that in a sentence the founder would recognise. It
**selects and orders** capabilities from a closed vocabulary and can never add one the rules
did not find.

The confidence asymmetry is the core judgement:

| Evidence | Confidence | Why |
|---|---|---|
| Live only | `confirmed` | A visitor reached it. That is the fact. |
| Live + code | `confirmed` | Same, with corroboration. |
| Code only | `likely` | The surface is built; reachability is exactly what was not established. |
| Neither | `not_found` | Vibe looked and saw nothing. |

Nothing reaches `confirmed` from repository evidence alone.

### 4. AI synthesis

One call, on Haiku 4.5, with **no thinking and no effort level**. It is the first operation
configured for **cost** rather than judgement, and that is a product decision: this runs
inside the free flow every new project goes through, so the answer to "should we run it?"
has to always be yes.

The absent reasoning parameters are a fact about the model before they are a preference.
Haiku 4.5 predates adaptive thinking and the effort control and rejects a request carrying
either — which this sprint shipped and had to fix; see *Dogfood result*. The task does not
want them either: the hard half of understanding a product is answered deterministically
before the call, and what remains is summarisation. `OperationConfig.reasoning` is therefore
a union — `{mode: "adaptive", effort}` or `{mode: "none"}` — so an effort level is only
reachable for a model that can honour one, and the pairing is checked by a test rather than
by a comment.

- Input minimization: URL paths are forwarded, **repository file paths are not**.
  `src/app/pricing/page.tsx` tells the model nothing `/pricing` does not, and file paths are
  where proprietary structure lives. Signed-in headings are dropped wholesale.
- Structured output over an array-of-fields wire shape, so one item schema compiles once
  rather than eleven near-identical objects (the grammar-size lesson Sprint 4 paid for).
- Validation independent of schema compliance: citations that do not resolve are discarded,
  and a `confirmed` claim that cannot cite anything is demoted to `unclear` with its value
  dropped.

**A failed model call does not fail the profile.** The deterministic half is already built
before the call, so a provider outage costs the paragraph and nothing else. The operation
completes, `synthesized` is false, and the screen says what did not run.

### 5. Persistence, reuse and correction

Two tables with deliberately different lifetimes:

- `product_profiles` — **derived**, replaced wholesale whenever evidence moves. Reuse is
  keyed on an input hash over the three snapshot ids plus the version set, so a new commit
  produces a new repository snapshot, a new id, a new hash, and therefore a fresh profile.
  Refresh-on-commit falls out of the identity rather than needing an invalidation system.
- `product_profile_corrections` — **authored**, one row per project, applied on read.

That split is what makes "a re-scan does not overwrite what the user told us" a property of
the schema rather than a rule to remember. A correction is a statement about the *product*,
not about one derivation of it.

### 6. The screen

Conclusion → identity → capabilities → brand → evidence → technical. The scanners are not
deleted; they are ordered behind the answer, one disclosure down.

- **Logo reveal** renders a real asset or a neutral mark. A URL is produced only when the
  product's own https origin is known and the asset lives on it — so a project with no
  production URL shows no logo even with one sitting in `public/logo.svg`, and a CDN-hosted
  logo is recorded but not rendered.
- **Progress** is three steps mapped to three real operation stages, with a step counter and
  a semantic `role="progressbar"`. No percentage, because there is no honest one.
- **"Did I get this right?"** — two real buttons and a plain labelled form. No dialog, no
  focus trap, no custom keyboard handling to get wrong.

## Non-Goals

Not implemented, deliberately: new audit scoring, paid audit, free-audit entitlement, first
free change entitlement, Pro subscription, Vibe Credits, credit packs, paywall, a new
execution engine, a coding-agent rewrite, the impact flywheel, full product memory, ads, SEO
generation, content generation, a motion system.

The Business Audit engine is untouched. The understanding screen links to it; it does not
change it.

## Acceptance Criteria

All met unless noted.

1. Repo and live intelligence remain technically separate evidence sources ✅
2. A central Product Profile exists ✅
3–7. Identity, purpose, capabilities, audience, journey can be established ✅
8–10. Brand logo, colours, typography can be detected ✅
11. Technical profile still exists ✅
12. Every important claim has source provenance ✅
13. Confidence is modelled in four levels ✅
14. Weak evidence is not overclaimed ✅ (enforced in `validate.ts`, not in the prompt)
15–18. AI step is structured, minimized, injection-aware, metered ✅
19–20. Profile is persisted; no re-synthesis per render ✅
21–23. Confirm, correct, and corrections survive a re-scan ✅
24–29. One understanding experience, real logo reveal, brand rendered ✅
30. Scanner raw data stays secondary ✅
31–34. Audit untouched, no credits, no paywall, no fake data ✅
35–38. Partial failure, mobile, accessibility ✅
39–43. lint / typecheck / 2935 tests / build / 88 E2E ✅
44. Vibe Business understood as a dogfood product ✅ — end to end, after the fix below.

## Dogfood result

### The defect the dogfood found: the model could not be called at all

The first real run of CORE-1 against the live product failed, every time, before it could
spend anything. Four attempts are in `product_profiles`, all `status: failed`,
`failure_code: token_count_failed`, with `provider`, `model` and `prompt_version` all null.

The cause was the parameter shape, not the account. The Anthropic adapter sent
`thinking: {type: "adaptive"}` and `output_config.effort` on **every** request, on the
assumption that every model Vibe calls is Sonnet-5-shaped. This sprint then pointed Product
Understanding at Haiku 4.5, which predates both and rejects the payload outright.

Two things made it hard to see, and both are worth keeping:

- **It failed on the free call.** The token count that gates every paid call is built from
  the same body as the billable one — deliberately, so the budget gate measures what will
  actually be charged. That correct design meant a bad payload took out the free call first,
  so the feature broke before reaching inference and never wrote a usage event.
- **The reported code pointed nowhere.** `countInputTokens` collapses a rejected payload and
  an unattributable error into the same `token_count_failed`, which reads as "transient,
  try again" — the exact failure mode Sprint 4 already paid for once with billing errors.
  The generation path distinguishes the two (`provider_request_rejected`, with a safe
  diagnostic); the counting path does not.

Two individually reasonable facts — a model chosen for cost, an effort level chosen for the
task — were jointly impossible, and nothing tied them together. `OperationConfig.reasoning`
is now that tie (see §4), with `operations.test.ts` failing if a config asks a model for
reasoning it cannot do. The user-facing copy for `token_count_failed` was also wrong on this
screen: it read "This could not be prepared", Change Preparation's vocabulary, on a step that
prepares nothing.

### Verified end to end

Confirmed by reading the deployed database rather than by re-running the pipeline here:

| | |
|---|---|
| Migration `20260815210000_product_understanding` | applied on the linked project |
| Profiles before the fix | 4 × `failed` / `token_count_failed`, 22:20–22:22 UTC |
| Profiles after the fix | 2 × `completed`, `synthesized: true`, 22:43 and 22:45 UTC |
| Model actually used | `claude-haiku-4-5-20251001`, `product-understanding-prompt-v1` |
| Cost | $0.009523 and $0.008479 per run |
| `thinking_tokens` | 0 in both runs |
| `estimated_input_tokens` vs `input_tokens` | 4563 / 4563 and 4404 / 4404 |
| Usage events for the 4 failures | none |

The last three rows are the ones worth reading twice. Zero thinking tokens is `{mode: "none"}`
doing what it says. The estimate matching the billed count **exactly**, twice, is the budget
gate measuring the same payload that was sent — the property the shared request builder
exists to guarantee, now confirmed against the real API rather than against a fake provider.
And no usage event for a failed count is what makes the new copy's "nothing was charged"
a fact rather than a reassurance.

Latency was 14.7 s and 8.5 s for the model call, inside operations that took 20 s and 13 s
end to end.

### Observed before the fix, from code alone

Run against the real Vibe Business checkout at `9591971`, using the real analyzer over the
real git tree. **The AI synthesis step and the database half could not run here**: this
session has no `ANTHROPIC_API_KEY` and no Supabase credentials. So what follows is the
deterministic half, which is what the brand, capability, journey and business-signal claims
rest on — and the semantic paragraph is untested against real data.

**What Vibe got right, from code alone:**

| | |
|---|---|
| Framework | Next.js |
| Database | Supabase |
| Accounts | Supabase Auth |
| Primary colour | `#00e5a0` — mint, correct, at `likely` |
| Text colour | `#f7f5f1` — correct |
| Body typeface | Space Grotesk — correct |
| Mono typeface | "Jetbrains Mono" — right family, wrong casing |
| Logo | `public/brand/vibe-lockup.svg` — correct |
| Capabilities | create an account, sign in, use a signed-in workspace |
| Business signals | no pricing path, no payment signals, no analytics, has accounts, has a signed-in area |

Two files were fetched to produce all of that: `package.json` and `src/app/globals.css`.
The evidence pack was 31 items and 3,861 characters.

**Three defects the dogfood found, all now fixed with regression tests:**

1. `--color-fg-secondary` — step four of an eight-step *foreground ramp* — was reported as
   the product's **secondary brand colour**. A ramp step is not a brand colour, whatever its
   tail says.
2. `--color-mint-ink` — the near-black text that sits *on* a mint fill — was reported as the
   product's **text colour**, because it is declared before `--color-fg` and `.find` was
   taking file order over specificity.
3. The runner-up saturated family was being reported as a secondary brand colour. In Vibe
   Business's palette that is amber, its *waiting* status colour. Second place is now not
   guessed at all.

**What is honestly wrong or missing in the dogfood:**

- **Mono typeface casing.** `next/font` gives `--font-jetbrains-mono`, which title-cases to
  "Jetbrains Mono" rather than "JetBrains Mono". The live layer restores the real spelling
  from a `font-family` stack when both sources exist; here there was no live snapshot.
- **No logo displayed.** Correct behaviour with no production URL — Vibe will not guess an
  origin — but it means the signature reveal was not exercised against real data.
- **No live product, no signed-in product, no model.** So audience, purpose, promise and the
  understanding paragraph are all `null` in this run, and the headline correctly falls back
  to "Here's what Vibe found." rather than claiming an understanding it does not have.

**Identity, brand, capabilities and trust** were answered by that deterministic run.
**Purpose and audience** need the model call, and that call is now confirmed to run and
persist a synthesized profile — but one limit is worth stating precisely rather than
rounding away: what was verified is that synthesis *happened*, from operation and usage
records. The resulting paragraph was not read back and judged here, so the §52 criterion
that matters most — a founder reads it and thinks *yes, that's my product* — remains a
human judgement, made by the maintainer on the live screen and not re-derived from the
database.

## Validation

| | |
|---|---|
| `pnpm lint` | clean |
| `pnpm typecheck` | clean |
| `pnpm test` | 2935 passed / 154 files |
| `pnpm build` | production build green, `/app/projects/[projectId]/understanding` routed |
| Playwright | 88 passed, chromium |

New unit coverage: evidence normalization and minimization, prompt injection, wire
normalization, confidence demotion, source priority, brand resolution, capability ranking,
correction survival, partial failure, one-call cost control, and the SQL/TypeScript
constraint pinning.

New browser coverage (`e2e/product-understanding.spec.ts`, 18 tests) at 1440 / 1024 / 768 /
375: reading order measured by bounding box, disclosure state, logo alt text and
`referrerpolicy`, keyboard order across the confirm controls, labelled editor fields,
heading nesting, and zero horizontal overflow at every width.

The browser suite found two defects a unit test could not: the confirm prompt was a styled
paragraph rather than a heading, and the evidence-source rows were unreachable by their own
labels. Both fixed.

## Risks / Notes

- **The migration is deployed.** `20260815210000_product_understanding` was read back from
  the linked project's migration history and is applied, as are all 25 before it. This
  replaces an earlier note in this file that recorded its state as unverified. Still confirm
  with `pnpm db:status` before any further `pnpm db:push` — [CLAUDE.md](../../CLAUDE.md)
  rules 29–34 require inspecting migration history first, and never assume a table's
  absence or presence.
- **The counting path cannot report a rejected payload.** `countInputTokens` maps a 4xx to
  the same `token_count_failed` as an unattributable error, while `generateStructured` maps
  it to `provider_request_rejected` with a safe diagnostic. That asymmetry is what made this
  sprint's defect read as transient. Left as-is rather than widened here, because
  `TokenCountFailureCode` is a deliberately narrow union and changing it touches every AI
  operation's failure handling — but it is the next thing to fix in this module, and the
  reason is now written down instead of rediscovered.
- **Existing snapshots predate brand detection.** Both analyzer versions moved, so reuse
  invalidates correctly, but a *stored* snapshot still has no `brand` key until it is
  re-analysed. `readRepositoryBrand`/`readLiveBrand` tolerate that rather than crashing.
- **Colour detection is hex-only.** A palette declared entirely in `oklch()` contributes no
  colour evidence. That is a real gap and a better outcome than an approximate colour shown
  as the product's brand.
- **Live brand reads inline CSS only.** Linked stylesheets are not fetched, which keeps the
  live budget unchanged and keeps CORE-1 inside "static HTML inspection". A framework that
  does not inline critical CSS contributes no live colour evidence and the repository side
  answers instead.
- **Motion hooks are in place, unused.** `scan started`, `code understood`, `public product
  understood`, `profile ready`, `confirmed` are all states the progress component already
  derives. A motion sprint can attach to them without restructuring anything.
- **Audit input preparation is documented, not wired.** The Business Audit still builds its
  own evidence pack v2 and is untouched. Where the profile belongs is: as a replacement for
  the founder-typed `business_context` prerequisite, or alongside it — that is a CORE-2
  decision with its own reuse-identity consequences, and making it here would have rebuilt
  the audit.

## Next Recommended Phase

**CORE-2** — free Business Audit → three Next Moves → pick one → Vibe builds it free →
before/after preview → first merge → *then* Pro and Credits.

CORE-1 ends with "Vibe understands your product." CORE-2 begins with "Now let's turn it into
a better business."
