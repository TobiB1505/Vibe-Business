# Sprint 11C.1 — Critical Merge UI Browser E2E

**Status:** ✅ Implemented — 9 browser tests, chromium, green in ~3 s.

## Problem

Every claim this project has made about what the **Merge** screen shows rested
on assertions about its *source code*: a test that read the component file and
checked which words appeared inside `<button>` elements.

That is not a substitute for a consequential screen, and this project has the
receipts. Sprint 11A ended with four consecutive defects where the domain was
correct and the screen was not:

| Reality | What the screen said |
| --- | --- |
| Preview running | "Preview required" |
| Screenshots stored | "Loading comparison…" |
| Sandbox stopped | nothing |
| Origin resolved | "Resolving preview address…" |

1979 tests were green through all four. Not one of them rendered a screen.

On a Merge panel that class of defect stops being a cosmetic annoyance: it is a
person pressing a button while believing something different from what it does,
on the one action in this product that moves a customer's default branch.

## Why the existing tests missed it

Each layer proves a different thing, and none of the existing ones proves this:

```
domain / unit        the logic is right                    1900+ tests
DB contract / RLS    the SQL says what the TypeScript says  migration tests
source assertions    the component *can't* render a word    approval-ui.test.ts
browser E2E          the user actually sees the state       ← this sprint
real dogfood         the provider semantics are real        manual
```

A source assertion can prove a **Merge to main** button does not exist. It
cannot prove that a blocked merge renders as blocked, that a confirmation
appears before a default-branch write, or that a reload does not resurrect a
stale state — which is precisely the family that keeps failing.

## What this layer proves

Nine tests, in a real Chromium, against a real production Next.js build:

| Scenario | Assertion |
| --- | --- |
| Confirmation | The primary action opens a dialog naming the branch, the from-SHA and the to-SHA — it never merges on one click |
| Cancel | Leaves the page offering, never acting |
| No authority creep | No **Deploy**, **Ship**, **Publish** or **Approve & merge** button exists |
| Repository changed (`not_eligible`) | "Not available", the drift explanation, "Vibe did not modify the repository", and **no merge button at all** |
| Repository changed (`blocked`) | Reads as stopped — never as failed, never as merged |
| Merged | The branch, the read-back SHA, and "not deployed" |
| Reload × blocked | Still blocked |
| Reload × merged | Still merged |
| Reload × open dialog | A half-confirmed merge does **not** survive a reload |

Every navigating test also asserts that **zero requests left the browser for any
external host**. It is a counter, not a promise: the route interception records
what was attempted and the test fails on a non-empty list.

## What this layer does NOT prove

Stated plainly, because overstating it would recreate the exact problem this
sprint exists to fix:

- **The wiring in `page.tsx`.** The fixture route hands the panels
  server-decided cards directly. It does not exercise the services that build
  those cards — and the 11A defects lived in exactly that wiring.
- **RLS, or any database behaviour.** No Postgres is in the loop.
- **The server actions.** Cancel is tested; confirm is not clicked, because
  there is no backend behind it in this harness.
- **Provider semantics.** That is what the real dogfood is for.

This is a floor, not a ceiling.

## Test environment

| Choice | Value | Why |
| --- | --- | --- |
| Runner | `@playwright/test` 1.62.1 | matches the `playwright-core` already used by the Browserbase adapter |
| Browser | Chromium only | nothing here is about rendering engines |
| Server | `next start` on :3311 | production build; the boundary bugs do not reproduce under `next dev` |
| Viewport | one desktop | responsive behaviour is not what this proves |
| Timeout | 15 s test / 5 s expect | no provider, no database — anything slow is a defect, not a wait |
| Retries | 1 in CI, 0 locally | only to capture a trace; never as evidence a test is healthy |

### Why fixtures, and why that is a compromise

The right environment is a seeded isolated database — `supabase start` — with
the real page rendering real rows. **That is not possible on the machine this
was built on: there is no container runtime installed** (no `docker`, no
Docker.app, no colima or podman), so local Supabase cannot start. Pointing the
suite at the production database was ruled out and stays ruled out.

So the harness feeds the real panels the same card objects the real page builds.
The upgrade path is direct and worth taking when a container runtime exists:
start local Supabase in the `e2e` CI job, seed rows, drive the real project page,
and delete the fixture route.

## Auth strategy

None, deliberately. The fixture route is not behind the app's auth, because it
renders no user data — it renders constants. That avoids committing any session
state, storage state or credentials to the repository, which the alternative
(a real logged-in fixture) would have needed.

The route is gated by `VIBE_E2E_FIXTURES=1`, set by the Playwright web server
and **nowhere else** — not in `.env`, not in Vercel, not in any deployment.
Verified against a production build without the flag:

```
/e2e/merge_ready   → HTTP 404
/e2e/merge_merged  → HTTP 404
```

## Deliberate regressions

Three, applied to the **product** code and reverted. Each broke the suite:

| Regression | Result |
| --- | --- |
| Confirmation removed — the button merges directly | ✅ 2 tests fail |
| Merge offered when the card forbids it | ✅ 1 test fails |
| A blocked merge renders as "Merged" | ✅ 1 test fails |

That is the point of the layer: all three are invisible to unit tests and to
source assertions, and all three would be visible to a user.

## CI integration

A separate **required** `e2e` job — not folded into `pnpm test`, because a unit
suite that silently launches a browser is one people stop running locally. It
installs Chromium, builds, runs the suite, and uploads the Playwright report and
traces on failure only (7-day retention). It is never allowed to fail.

## Local developer workflow

```bash
pnpm build        # the suite runs against a production build
pnpm test:e2e     # headless
pnpm test:e2e:ui  # the Playwright UI, for debugging
```

`pnpm test` does not launch a browser. Traces, screenshots and reports are
gitignored — they can contain whatever was on screen.

## Known limitations

- Fixtures, not a database (above). The most important gap.
- One browser, one viewport, no mobile.
- No pixel snapshots — deliberately. The problem is incorrect application
  state, not 2 px of visual drift.
- The confirm path stops at the dialog.
- `@playwright/test` is a new dev dependency. CLAUDE.md rule 38 bars browser
  automation from the **product** (live product intelligence stays static
  HTTP/HTML); this is a test-only runner and does not change that scope.
