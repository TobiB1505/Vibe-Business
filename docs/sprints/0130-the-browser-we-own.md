# The browser we own

**Recorded 2026-09-02, after the work.** The second of two steps the founder
asked for in sequence. The first deleted the visual review; this one takes the
Deep Scan off Browserbase.

## The plan that did not survive being checked

The ask was to reuse the **preview** sandbox for the Deep Scan, since a person
could sign in there and Vibe would only pay for the sandbox.

Reading the code said no, and the reason is not visible from outside it. A
preview runs the customer's repository at a pinned commit with **no environment
at all** — `provisionPreviewWorkspace` refuses a privileged environment before
it creates anything, and a test asserts it. No database, no auth keys, no user
accounts. The app renders a login page and every login fails.

The Deep Scan points at the customer's own `production_url` and they sign in
with their real account. That is what makes it worth anything, and it is exactly
what a preview cannot be.

**The economics were also not what the plan assumed**, and the database said so
before a line was written: **5 browser sessions totalling 190 seconds**, **7
analysis runs totalling 3.6 minutes**, across all of production. Per-scan
browser time is close to free at anyone's rate. What costs money is a
subscription — so the saving is real only if Browserbase leaves entirely. Told
that, the founder chose direct replacement over running both.

So the shape that shipped is the ask turned one notch: Vibe's own browser, in
Vibe's own sandbox, pointed at the customer's production site.

## The port did not change

The single most load-bearing fact of the sprint. `BrowserSessionProvider` is
four verbs, and the analyzer, its read-only policy, the route budgets, the
entitlement rules and the billing all sit above it. Not one was touched. A
boundary that survives its first provider swap was drawn in the right place, and
the port's own docblock now says so rather than being rewritten to look
inevitable.

## What was built

**A sandbox with no customer code in it.** A third `SandboxSource`, `image`:
the base image and nothing else. No clone, no credential, no filesystem. This is
what makes the rest defensible rather than a series of exceptions — the rules
governing validation and preview describe a hazard this VM does not have.

**A guard in front of the one public port.** Chromium's DevTools endpoint has no
authentication and never will, so it listens on loopback and a Vibe-authored
program is the only thing the outside reaches. Two tokens, because two very
different callers arrive there: `control` is a byte pipe to CDP and stays on
Vibe's server; `view` travels to a browser and is **not** a pipe — a closed
four-message vocabulary translated into five named CDP calls.

That is strictly less than what it replaces. The old live view was a full
DevTools frontend with an address bar, in an iframe needing `allow-scripts` and
`allow-same-origin` together. What arrives now is a JPEG on a canvas, which
executes nothing.

**An image built once and reused**, keyed on the guard version, rebuilt
lazily by the next read that finds none. No cron, no queue.

## Three things I got wrong and fixed

Worth listing because each was silent, and two of them were mine.

**The tokens were random, and had to be derived.** Random is simpler and it is
wrong here, for a reason that belongs to the flow rather than to cryptography:
the manual-login lifecycle spans two server requests, and the second has to find
the token again. The two ways are to store it or recompute it, and storing it
puts a bearer credential for a browser already signed into a customer's product
into a database row — the exact artefact ADR 0012 declined to hold. So: HMAC
over the sandbox name, keyed by one server secret, purpose and guard version in
the label. Nothing at rest.

That fix immediately exposed a second: `getBrowserSandboxEnv` memoized whatever
it parsed first, including from a named source, which made the test seam useless.
Three tests said so.

**A backtick inside the guard program ended it early.** In a comment explaining
the `ws` import — inside a template literal whose whole discipline is that it
contains no backtick. The explanation now lives outside the string, and the
no-backtick test is what would have caught it either way.

**`--incognito` would have made every scan report a signed-out product.** The
login would have landed in an incognito context while `connectReadOnly` reads
`browser.contexts()[0]` — the default one. No crash, no message: just a Deep
Scan confidently reporting nothing behind the login. `connector.ts` already
carried a comment about this mistake in its other form; I built it in a form the
comment did not cover. It also bought nothing, since the profile lives in a VM
destroyed with the session.

## Two bugs the swap uncovered, both in money

Neither was introduced by this work. Both were found because a type changed.

`projection.ts` hardcoded `provider: "browserbase"` rather than reading the row,
so every scan run in Vibe's own sandbox would have been filed under a provider
Vibe no longer uses — **in the ledger every price is derived from**. Correcting
it revealed the second: `reconcileDeepScanUsage` had never selected the column at
all, which nothing could notice while the value was a literal.

## Deep Scan stops being the unmeasured price

It was the last priced operation with `basis: "policy"` and no measured cost
behind it — 25 Credits of revenue against a bill nobody could compute.

`terminateSession` returned `Promise<void>` and threw the figures away at the one
moment they exist, since a running sandbox has no final wall clock. It now
reports what `stop()` measured, and `estimateSandboxCost` derives a figure under
the same rate card, columns and `cost_estimated` status the agent's sandboxes
use — so the two sum together and neither is mistaken for a bill.

Against the five real session shapes:

| Wall clock | Estimated cost |
|---|---|
| 10 s | $0.00066 |
| 20 s | $0.00104 |
| 31 s | $0.00145 |
| 43 s | $0.00190 |
| 86 s (longest real) | $0.00353 |
| 300 s (ceiling) | $0.01161 |

Against $0.441 of revenue that is **97–99%**, the highest margin in the rate
card. Nothing is backfilled: the seven historical rows ran at Browserbase under
no rate Vibe holds, and giving them a Vercel figure would date an estimate to a
provider that did not run them.

## What was already there and stayed there

The founder asked whether the "I'm logged in — Analyze" button existed. It does,
and has since Sprint 5 — `deep-scan-panel.tsx:272`, wired to `analyzeDeepScan`
through the same port. Checking rather than assuming is what turned up the
`--incognito` defect, which lived one layer under that exact button.

## Verification

7,436 unit tests green, lint 0/0, typecheck and build clean. Planted defects
were used rather than assumed: the view channel forwarding raw bytes, a sixth
CDP method, a distinguishable refusal at the port, a discarded measurement, and
an estimate written into the provider's cost column — each caught by exactly one
test.

## What this does not prove

**Nothing has run in a real Vercel sandbox.** Downloading Chromium, installing
`ws`, resolving Playwright's revision-numbered path, the screencast, the input
translation, a real OAuth popup — none of it. It is asserted in shape, and the
first real Deep Scan is where that changes. Rule 69's fourth question is
unanswered on purpose rather than by omission: provider semantics matter here
more than anywhere in this repository, and this record is not going to claim
otherwise.

**There is no fallback.** Direct replacement was the founder's call after the
risk was named. Reverting means restoring an adapter from git history.

## The migrations, and a naming correction

Three, applied to production on 2026-09-02 and verified by reading the schema
back rather than by trusting three `success` replies: the table exists with RLS
on and **zero policies**, the provider CHECK admits both names, the five new
columns are present, and **0 of the 7 historical rows carry an estimate**.

They went through the Supabase MCP rather than `supabase db push`, because this
container has no linked project and `pnpm db:status` refuses without one. That
has one consequence worth recording, because it is the kind that surfaces weeks
later as a confusing failure: **MCP assigns its own version timestamps**, so the
applied versions were `20260902173050/173102/173120` while the files were named
`170000/171000/172000`. Two histories that do not agree, and a later `db push`
would have tried to apply all three again onto a schema that already has them.

The files are renamed to the applied versions. Rule 34 says the files are the
source of truth and the remote converges to them — here the remote had already
recorded a version, and the honest fix is the one that makes both histories name
the same migrations rather than the one that looks tidier.

## A fourth migration, and the defect CI did not report

The schema job went red on `browser_runtime_images`: `anon` and `authenticated`
hold `TRUNCATE`, `REFERENCES` and `TRIGGER`. The creating migration argued that
RLS with no policies was the whole access rule, and that is true for SELECT,
INSERT, UPDATE and DELETE and **false for TRUNCATE** — RLS does not govern it,
so a role holding it empties the table regardless of every policy.
`owner-pin.migration.ts` already carried that sentence in its own docblock.

**Reading the grants afterwards found the larger half.** `service_role` held
those same three and **no `SELECT` and no `INSERT`** — the default-privileges
revoke covers it too, deliberately. The first Deep Scan would have failed with
`42501` at the image lookup: before the insert, before the browser, before
anything a person could see a reason for. The feature was dead on arrival and
the red check was a different symptom of the same forgotten line.

Which is exactly what `20260823220000_data_api_default_privileges.sql` predicts
in its own header — *"a migration that creates a table and forgets its grants
produces a table the Data API cannot see. That fails loudly in CI."* It did.

**And the first reading of the failure was wrong.** It blamed the shared default
for revoking four privileges and not seven. Checking the other 51 tables
disproved it: not one holds `TRUNCATE`, because the convention here is that each
migration states its own grants —
`20260825132534_founder_input_resolution.sql` is the pattern. The shared default
is untouched; the gap was this migration's.

`VIBE_BROWSER_SESSION_SECRET` must be set before a scan can start.
`BROWSERBASE_API_KEY` can be removed, and the subscription with it.

[ADR 0076](../decisions/0076-the-browser-we-own.md).
