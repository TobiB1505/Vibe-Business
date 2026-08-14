# Sprint 11A — Before / After Review Artifact

**Status**

| Slice | State |
| --- | --- |
| ReviewArtifact domain, capture, storage, UI | ✅ Complete |
| Migrations deployed and verified | ✅ Complete |
| Real dogfood | ✅ Done, 14.08.2026 |

**Sprint 11A is complete.** A real comparison was captured against the live
product, survived the preview's teardown, and is viewable.

The capture path worked on the first attempt. **Four defects surfaced anyway,
and every one of them was the product failing to report what it had already
done correctly** — a running preview reported as absent, stored screenshots
reported as loading, a completed stop reported as nothing at all. The tests
proved the domain; only the dogfood could prove the wiring.

## Goal

Let a user answer one question: **what did Vibe actually change?**

## Why review is its own gate

```
repository_write_verified   the bytes on the branch are the bytes we meant
sandbox_validation_passed   those bytes install, typecheck, test and build
preview_available           that exact artifact runs and is reachable
review_artifact_available   ← this sprint
human_approved              someone looked and decided
merged / deployed           neither exists
```

`review_artifact_available` means: *Vibe captured a controlled representation of
the current live product and of the prepared preview, so a person can compare
them.* Nothing about quality, design, SEO, approval or merge safety.

Sprint 10B gave the user a preview they could open. What it did not give them
was a way to *see the difference* without holding two tabs side by side from
memory, before the preview expired. Full rationale:
[ADR 0017](../decisions/0017-visual-review-artifacts.md).

## Scope

- `public_visual_review_v1` profile and `review-policy-v1`
- `ReviewArtifact` persistence with a private screenshot bucket
- `BrowserCaptureProvider` port and a Browserbase adapter
- `change_review` durable operation: capture both sides, store, converge
- A `Review` section with a side-by-side comparison
- A narrow browser-usage ledger, service-role writes only

## Non-Goals

- **Approval, merge, deploy.** None of these exist anywhere in the codebase.
- **Authenticated comparison.** Production and preview auth state are not
  comparable without moving credentials between origins, which Vibe will not do.
- **Multi-route, mobile, or full-page review.** One route, one desktop viewport.
- **Any visual judgement.** No score, no "improved", no AI looking at images.
- **Pixel diffing or DOM diffing.**
- **A Browserbase → Cloudflare migration.** The port makes it a later swap.

## What was built

### Before and after, precisely

| Side | Source | Semantics |
| --- | --- | --- |
| Before | the project's **verified production URL** | the public live product *as observed at capture time* |
| After | the exact running **PreviewSession** | one specific sandbox, not a branch or a commit |

Never a client-supplied URL on either side. A caller who could name the "before"
URL could point Vibe's browser at any site and have the screenshot stored under
their project as though it were their product.

"Before" is deliberately **not** claimed to be a base commit. Production may
have been anything at that moment; `before_origin` and `before_captured_at` are
recorded, and a later production change never regenerates a historical artifact.

### Comparability, pinned and enforced

`review-policy-v1` fixes route `/`, viewport 1440×1000 @1×, fixed-frame (not
full page), a 20 s navigation timeout, a 2.5 s bounded settle, PNG, and CSS
animation freezing. Both sides read the *same* constant.

Two choices worth naming:

- **Fixed viewport, not full page.** Full-page height varies with content, so
  two of them cannot sit side by side without scaling one — and scaling is how a
  comparison starts lying.
- **Bounded settle, never `networkidle`.** A live product can hold a connection
  open indefinitely; waiting for idle turns a screenshot into an unbounded,
  billed browser job. The Deep Scan connector learned this first.

The database enforces the part that matters: a `ready` artifact must have both
sides captured **and identical dimensions**. A wrong workflow cannot store a
mismatched comparison.

### Browser isolation

```
untrusted website → isolated browser → screenshot image → Vibe review UI
```

No iframe, no proxy, no DOM import, no page HTML persisted. The adapter creates
a **fresh context per capture** — never Deep Scan's authenticated one — with no
`storageState` in or out, and releases the provider session in a `finally` on
every path including failure.

### Storage and privacy

Private bucket whose only `storage.objects` policy is **SELECT**, for objects
under a project the caller owns. No INSERT, UPDATE or DELETE policy exists, so
writes and deletions stay service-role-only. The only route to an image is a
short-lived signed URL minted server-side *after* ownership is confirmed.
Authorize, then sign — the other order hands a capability to whoever asked.

That SELECT policy was added by the dogfood, not designed in; see
[finding 2](#dogfood-finding-2--a-ready-comparison-nobody-could-open).

Signed URLs are never persisted, never logged, never in an audit event, never in
an AI prompt. Retention is **7 days**, chosen: longer than the preview it came
from, bounded rather than indefinite.

### The artifact outlives the preview

`preview_session_id` is `ON DELETE SET NULL`. Stopping a preview correctly must
not destroy the comparison it produced — otherwise a sandbox would be kept
running so a screenshot stays visible. **Open preview** disappears; the images
do not.

### No hidden spend

Nothing captures on preview-ready, page load, panel open, or validation passing.
Only an explicit **Generate comparison**.

## Acceptance Criteria

- [x] ReviewArtifact implemented, with exact PreparedChange/Preview linkage
- [x] Screenshots private and authorized; short-lived server-minted URLs
- [x] Identical viewport and policy on both sides, enforced by the database
- [x] Partial failure is a failure, and cleans up its uploaded image
- [x] Browser session released on every terminal path
- [x] Provider usage recorded; `provider_cost_usd` null
- [x] Zero AI calls in the review path
- [x] Comparison survives preview teardown
- [x] DB-contract tests pin the TypeScript unions to the SQL CHECKs
- [x] Migration deployed; bucket and policies verified live
- [x] Real dogfood: comparison captured, viewable, and surviving preview teardown

## Validation

```
pnpm lint         ✅
pnpm typecheck    ✅
pnpm test         ✅  1925 tests, 102 files
pnpm build        ✅
pnpm db:status    ✅  no pending migrations
pnpm db:lint      ✅  no schema errors
```

Verified live after deploy: bucket `review-screenshots` is `public = false`,
PNG-only, 16 MB limit; `review_browser_usage` has a SELECT policy and **no
INSERT policy**.

### Mutation validation

Fourteen mutations applied and reverted. Every one broke at least one test.

| # | Mutation | Result |
| --- | --- | --- |
| 1 | Matching-preview requirement removed | ✅ fails |
| 2 | Cross-user authorization removed | ✅ fails |
| 3 | Client-controlled before URL accepted | ✅ fails |
| 4 | Client-controlled after URL accepted | ✅ fails |
| 5 | Viewport equality removed | ✅ fails |
| 6 | Partial comparison marked ready | ✅ fails |
| 7 | Review auto-starts on card read | ✅ fails |
| 8 | Browser session never released | ❌ → added adapter test, then ✅ |
| 9 | Storage authorization removed | ✅ fails |
| 10 | Expired artifact still signs | ✅ fails |
| 11 | Reuse Deep Scan's authenticated context | ❌ → fixed the mock, then ✅ |
| 12 | Provider usage silently skipped | ✅ fails |
| 13 | SQL CHECK no longer matches the TS union | ✅ fails |
| 14 | `ready`-needs-both-sides CHECK dropped | ✅ fails |

**Two initially survived**, and both were gaps in the *test doubles* rather than
in the code:

*Mutation 8* survived because no test exercised the real capture adapter — the
domain fake could not model a provider session at all. `capture.test.ts` now
mocks Playwright at the module boundary and asserts the session is released on
success, on navigation failure and on a CDP failure.

*Mutation 11* — reaching for `browser.contexts()[0]`, Deep Scan's authenticated
context — survived because the mocked browser reported *no* existing contexts,
so the mutation fell through to the correct path anyway. The mock now returns a
context standing in for a signed-in session, and the test asserts it is never
touched. This is the single most security-relevant line in the adapter, and it
was untested until a mutation said so.

### A contract-test defect this sprint exposed

Adding `review_browser_usage.status` broke the Sprint 10B preview contract test.
Its helper took the last `check (<column> in (...))` **anywhere** in the
migration history, so a second table using the same column name silently
redirected the preview-status assertion at the wrong constraint.

A column name is not a unique key across a schema. The helper is now shared and
**table-aware** (`migration-test-support.ts`), and both sprints' contract tests
use it.

## Real dogfood — done, 14.08.2026

Performed against the historical SEO PreparedChange
`vibe/seo-foundations-cc32273131c5` (`2f05958`), through the deployed UI.

**The capture path worked on the first attempt. Everything that failed was the
product reporting it** — four findings, all below.

| What | Result |
| --- | --- |
| ReviewArtifact `eb255685` | `ready` in 15 s |
| Both sides | `captured`, 1440×1000 on both |
| Before | `https://vibe-business-fawn.vercel.app/` at `23:55:03.196Z` |
| After | preview session `58237e12` at `23:55:03.848Z` |
| Storage | two PNGs, 55198 bytes each, private bucket |
| Browser ledger | 1 session, 10083 ms, 2 captures, `provider_cost_usd` null |
| AI calls | 0 |
| Operation | `change_review` → `completed` |

**Both images are byte-identical** (`sha256 344c6793…`), which is what §50
predicted — and precisely why it was checked rather than accepted. Two
independent confirmations that this is a real result and not a collapsed
comparison:

- the capture step builds the after URL from `resolvePreviewOrigin(...)` and the
  before URL from `artifact.beforeOrigin`, so the two origins differ by
  construction;
- `src/app/page.tsx`, `layout.tsx` and `globals.css` are **byte-identical**
  between `2f05958` and `origin/main`. Everything that differs lives under
  `/app/…`, docs, or `robots.ts`/`sitemap.ts`. The logged-out homepage renders
  from the same source on both sides.

**§52 confirmed.** After the preview was stopped, the session row is `stopped`,
the artifact is still `ready`, both images are still stored and still viewable.
The comparison outlived the sandbox it photographed — the property the whole
artifact separation exists for.

### The spend this required, stated before it was incurred

Sprint 10B's teardown deleted the ValidatedArtifact when the preview was
stopped, so there was no artifact to preview and none would be created
automatically.

| Step | Cost |
| --- | --- |
| 1. Validate `vibe/seo-foundations-cc32273131c5` (`2f05958`) once | ~5 min sandbox |
| 2. Start preview once | ~12 s to reachable, then a 15-min sandbox |
| 3. **Generate comparison** once | one Browserbase session, two captures |

No repeated runs for UI tuning.

### What to verify

- ReviewArtifact `ready`; both images load; same dimensions on both sides
- **Open current** works; **Open preview** works while the preview is alive
- **View code diff** still works
- No approval, merge or AI-judgement control anywhere
- Then **stop the preview** and confirm the comparison is *still viewable* —
  the property the whole artifact separation exists for (§52)

### The expected result, recorded in advance

The SEO change touches `robots.ts` and `sitemap.ts`. **The homepage should look
visually identical.**

That is not a failure and it is not a reason to go looking for a pixel
difference. It is the honest outcome, and it demonstrates something worth
knowing: a visual comparison proves the review *pipeline* works, not that every
code change is visible in pixels. `/robots.txt` and `/sitemap.xml` in the
preview are where that change is observable.

### Dogfood finding 1 — "Preview required" beside a running preview

The first real run showed the Preview section running with 14 minutes left and
the Review section saying *Preview required*. The database was right: the
session row said `running`. The **page render** was stale.

The preview panel polled every 2 s and called `router.refresh()` on every tick
while running. This page render costs a sandbox provider call and several reads,
so a refresh can outlast the two seconds until the next one — and each new
`router.refresh()` supersedes the one still in flight. For a fifteen-minute
preview that is ~450 re-renders, of which one may never land.

The preview panel hid the failure from itself: `previewState` prefers what the
poll just learned, so it rendered the running preview correctly while the page
around it still held the state from *before* the preview existed. The Review
section, reading that same render, could only say "Preview required".

Fixed by refreshing on the **transition** — when the polled status differs from
what the card already shows — instead of on every tick. A hard page reload was
the workaround, and is why the dogfood did not need a second paid preview.

The general shape is worth keeping: *a panel that compensates for its own stale
props hides the staleness from every sibling that does not.*

### Dogfood finding 2 — a `ready` comparison nobody could open

The capture itself worked on the first attempt: both sides captured in 15 s, one
Browserbase session, 10.1 s billed, 2 captures, both PNGs stored, artifact
`ready`, ledger row written. Then the panel said **"Loading comparison…"** and
kept saying it.

Nothing was loading. `getReviewImages` had returned null because
`createSignedUrl` failed — and it failed because the bucket had **no**
`storage.objects` policy. Signing is an RLS-checked read performed with the
caller's own token, so "no policy" locked out the owner too. Verified directly:
as the owning user, `select count(*) from storage.objects where bucket_id =
'review-screenshots'` returned **0**.

Fixed by `20260814100000` — a SELECT-only policy for objects under a project the
caller owns. The write side is unchanged and still has no policy.

**And the first fix silently did nothing.** Its predicate read
`p.id::text = (storage.foldername(name))[1]` inside `select 1 from
public.projects p`, and `public.projects` has a `name` column — so `name` bound
to the *project's display name*, not the object path. The policy asked whether a
project's name, split on `/`, began with its own id. It never does. Valid SQL,
right bucket, right intent, zero rows. `20260814101000` qualifies it as
`storage.objects.name`.

An unqualified column name is a guess about scope, and inside a policy that
guess fails silently — no error, just a row that never matches. The same lesson
the contract-test helper taught earlier this sprint, in a place where nothing
would have raised.

Verified after the fix, by simulating each caller against the live database:

| Caller | Objects visible |
| --- | --- |
| Owner (`auth.uid()` = the project's user) | **2** |
| Another authenticated user | 0 |
| `anon` | 0 |

This is the mirror image of Sprint 10B's ledger bug. There, a write the
application had authorized was refused by RLS and the error was swallowed. Here,
a read the application had authorized was refused by RLS and the absence was
rendered as a loading state. Same false premise: *the application checked, so
the database does not need to.* A gate closed to everyone is closed to the owner
too.

Two things made it worse than it needed to be, and both are also fixed:

- **The ADR asserted the wrong mechanism** and the code comments repeated it, so
  three places confidently documented a posture that did not work. ADR 0017 §9
  now carries the correction rather than the original claim.
- **The UI called it "Loading…"** — a lie that never resolves. A `ready`
  artifact whose images cannot be signed now says the images are unavailable and
  suggests a reload, because "captured but unopenable" is a real state and
  deserves its own sentence.

### Dogfood finding 3 — Stop preview reported nothing

The stop itself worked on the first click: the session reached `stopped` three
minutes before its deadline, teardown ran, the artifact was released. The user
saw none of it.

Three separate causes, all in the panel:

- **The running block stayed on screen.** There was a `starting` intent that
  won over the server render, but no `stopping` one — so a click left the
  origin, the countdown and "Anyone with the preview URL…" in place, with only
  the button's label changed. Now symmetrical: an in-flight stop renders the
  stopping section, which claims an *intent*, never an outcome.
- **The action's result was discarded.** `stopPreviewAction` returns a typed
  failure and the panel threw it away, so a refused stop produced no message and
  no state change — indistinguishable from a click that never registered.
- **The refresh could not land**, per finding 1.

Worth stating plainly: the domain was correct all three times a dogfood said
"it doesn't work". Sandbox stopped, ledger written, artifact released — and the
screen said otherwise. A correct backend that cannot report itself is
indistinguishable, to the person paying for it, from a broken one.

### Dogfood finding 4 — "Resolving preview address…" for an origin already resolved

Smaller, same family. The page resolves the preview origin server-side, but the
preview panel read only its own poll, so a freshly loaded page showed
"Resolving preview address…" until the first poll returned ~2 s later. The panel
now prefers the poll and falls back to the server render.

## Known limitations

- **One route, one desktop viewport.** A change below the fold, on another page,
  or only visible on mobile does not appear. The product must not imply
  otherwise.
- **Public pages only.** Anything behind a login is out of scope and reported as
  `review_auth_required_not_supported` rather than approximated.
- **Animation freezing is best-effort.** CSS animation, transitions and caret
  blinking are disabled; a canvas animation or playing video is not.
- **"Before" is a moving target.** Production can change between comparisons.
  Recorded as a timestamp rather than pretended away.
- **Seven-day retention.** An old comparison eventually stops being viewable.
- **`review_auth_required_not_supported` is not yet detected automatically.**
  The code exists and is honest when used, but nothing currently classifies a
  page as login-required — a logged-out render is captured instead. Detection is
  its own piece of work.
- **No component tests.** The project has no React testing tooling and tests
  pure view functions instead, which the review state machine is.
