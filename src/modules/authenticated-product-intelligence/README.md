# modules/authenticated-product-intelligence

The Deep Scan — see [ARCHITECTURE.md §3 "Layers with no section above"](../../../ARCHITECTURE.md#layers-with-no-section-above), [ADR 0012](../../../docs/decisions/0012-authenticated-browser-analysis.md) and [ADR 0076](../../../docs/decisions/0076-the-browser-we-own.md).

Most seriously-built products keep almost everything behind a login. The public scan in [`live-product-intelligence`](../live-product-intelligence/README.md) sees a marketing page; it cannot see the application. This module can, because **the founder signs in themselves** in a browser Vibe provides, and then hands the session over for analysis.

That makes it the one place in this repository where a real browser is admitted — and the reason every other rule here is a restriction.

## The only acceptable default is that nothing can change their data

Once the session is handed over, Vibe is operating inside someone's live application while logged in as them. `read-only-policy.ts` is the decision layer, kept pure so it can be exhaustively tested; the Playwright adapter applies it. It decides two things: whether a request may proceed (mutating methods are refused), and whether an event is allowed at all (downloads, permission prompts).

The honest limitation is surfaced rather than hidden. Some applications hydrate over POST — GraphQL, server actions, tRPC batching — and blocking those can leave a page half-rendered. **Vibe blocks anyway and reports it**, because a wrong audit is recoverable and a deleted customer record is not.

No session is persisted, no screenshot is taken, and the analysis is same-origin only.

## The browser is one Vibe builds, in a sandbox it owns

[ADR 0076](../../../docs/decisions/0076-the-browser-we-own.md) replaced the third-party browser provider with Chromium running inside a Vercel sandbox Vibe creates. `playwright-core` is the only browser package this repository depends on, and Chromium is installed into that sandbox image — never into a Vibe runtime (rule 38).

Chromium's DevTools endpoint has **no authentication of any kind and never will** — the protocol assumes it is reachable only from the same machine. Exposing it directly would hand full control of the browser, including `file://` reads of the VM, to anyone who learned the URL. So Chromium listens on loopback only, and `sandbox-browser/guard-program.ts` is the single thing the outside can reach, behind two separate capability tokens: one channel for the founder's live view, one for Vibe's own analysis.

That guard is a string constant rather than a file for the same reason the agent's sandbox program is: it has to arrive in a microVM created seconds earlier, and what it contains is a security property. As a constant it is reviewed in the repository, versioned with `BROWSER_RUNTIME_VERSION`, and asserted against by tests.

It contains **no interpolation** — not one `${`, not one backtick. Both tokens, both ports and the viewport arrive through the process environment and are read inside the sandbox, so there is no point at which a token, a URL or anything a user typed could become program text. A test asserts that absence rather than trusting a reading of the file.

## The picture, and why its size is a decision

Chromium runs at **1920×1200** and the screencast casts at exactly that, at JPEG quality 72. It was 1280×800 at quality 60, and a founder on a high-density display said the preview looked wrong "resolution-wise" — twice over. The dialog lays the frame out around 1120 CSS pixels, which on a 2× screen is 2240 device pixels, so a 1280-pixel JPEG was being stretched most of the way to double. And 1280 is a *narrow* desktop: an application with a sidebar renders its cramped layout there, so the analysis was reading a product shape the customer's own users do not see.

The viewport and the cast ceiling must be equal — a cast smaller than the window is scaled down, and the canvas maps a click through the frame's coordinate space, so the tap lands somewhere other than where the person aimed. The guard holds those numbers as literals, because it contains no interpolation and that absence is a security property, so `guard-program.test.ts` asserts the equality rather than a comment claiming it.

The dialog's box is sized **from the frame**, not from a constant. A hardcoded aspect ratio in the UI restating a viewport in the runtime is a disagreement waiting to happen, and stretching is the worst symptom to ship: the click maths still looks right in code.

## Smaller budgets than the public crawl, deliberately

A real browser rendering a logged-in application is expensive in provider seconds and can contain real customer data. `budgets.ts` is therefore _tighter_ than the public crawler's, and reaching a budget degrades the result to partial rather than crawling on (rule 39).

It also refuses to spend a page on something the public scan already read. A page the live product crawl fetched and rendered **anonymously** is not authenticated product — it is described already, statically, for no browser seconds and no Credits — so it is not a candidate here, whether it arrives as a repository route or as a link in the signed-in shell's own footer. Only the landing page is exempt, because it is where the browser already is. A path the public crawl watched *bounce to a login page* is the opposite case and ranks highest: that is proof the route is part of the signed-in product.

Page content is untrusted data, never instruction (rule 36): what is extracted is sanitized into typed signals, and what is stored is derived intelligence with short evidence labels — never page source, body text, cookies or query strings (rule 37).

## Reading a page instead of passing through it

`goto` resolves when the document exists, which for a single-page application is the beginning of its work rather than the end: it then checks the session, redirects to a canonical path, or replaces the URL once its data arrives. The loop used to read and then navigate inside that window, so a page was killed by the page before it — `Execution context was destroyed` for the read, `interrupted by another navigation` for the next hop. One measured run inspected **one** page of sixteen.

So every page is now let go still before anything is read from it: `AnalysisPagePort.settle` waits for the URL to hold still for half a second, then best-effort for the network to go quiet, capped at five. URL stability is the signal that always terminates; `networkidle` is the one that catches a shell fetching its data without changing the URL, and it is best effort because a logged-in application often polls and would never reach it. Reaching the cap is not a failure — the page is read as it stands.

Settling also decides *where* Vibe thinks it is. An application that redirects itself after `goto` returns has not finished choosing its URL, so the landed path is read after the wait, not before it.

Vibe navigates by URL and **never clicks** (`FORBIDDEN_INTERACTIONS`). Links found in the signed-in UI do become candidates — that is the crawl — but a click's destination and side effects are whatever the page decides they are, and this analysis runs logged in as the customer.

## Two minutes to sign in, and you can see them

A sandbox bills for every second it exists, and this one exists to hold a login form. The provider ceiling is ten minutes, which is nine minutes of paying for an empty room when somebody walks away mid-flow.

`LOGIN_DEADLINE_MS` is two minutes, as one constant, and the countdown is on screen from the moment the browser is — not from when the dialog opens, because a cold sandbox can take two minutes to build and charging that to the founder's sign-in time would be billing them for Vibe's own wait. It stops the instant the scan starts. When it runs out the browser is terminated on the same path as Cancel, so nothing is charged, and the panel says which of the two happened.

Two minutes is tight for a password manager plus a second factor on a phone. The mitigation is that it is *visible*: somebody who can see thirty seconds left knows to hurry, where somebody who can see nothing is simply cut off.

## The handoff, and why it is allowed to be decoration

The live view is useful for the first seconds of an analysis — a person can watch the crawl start — and after that it is a video of pages flicking past that nobody is driving. What followed was a spinner and a seconds counter.

`scan-handoff.tsx` hands the picture over instead: the frame switches off the way a CRT does, the mark takes its place, and Vibe visibly gathers while the analysis runs. It holds the three obligations in code rather than in a comment — bound to an observed state (mounted only while an analysis Vibe started is running, so it cannot appear over a pending, paused or failed scan), removable without loss (every word a founder needs is in the status panel below it), and carrying no timing (a fixed period; nothing accelerates, fills or counts down).

It is bound to `analysing`, not to `busy`, and that distinction is the fix for a real defect: `busy` means *a server action is in flight*, which is equally true while Vibe is **creating** a browser. `handleStart` sets it and opens the dialog in the same tick, so the switch-off played over a frame that had not connected yet and the founder saw the animation fire on opening the panel. The same wrong signal drove the status panel, which said "Vibe is looking around your signed-in product" with a counter under it during the twenty seconds before there was a browser to look around in. `handoffRunning` is a pure function now, because a choice is testable where a line of JSX is not.

Four scenes, because the scan runs for a minute and a half and one of them is not enough: the switch-off, a **boot** — an indeterminate sweep, never a filling bar, because a bar would reach its end in two seconds and then sit full for another ninety over a scan still running — the gathering, and a **check** when the result lands. The check is reachable only from `succeeded`, which is set when the analysis has come back; success animated before success exists is the first entry on the never-animate list. The dialog closes *after* it, so the last thing a founder sees is Vibe finishing rather than a window vanishing.

The glyphs are page furniture — an `@`, a folder, a cart, a table, a code snippet. They carry **no text**, and that is deliberate rather than timid. Everything else on screen during the animation is decoration a person reads as decoration; a tile reading `/app/billing` would be the one element they read as *information*. Vibe does not know from here which page is being read at any moment — the analysis runs inside one request and reports when it is done — so that path would be wrong, and a screen that makes things up costs more than an animation earns.

## The window follows the device; the reading does not

A phone driving a 1920-pixel desktop page is the fiddliest part of this flow — the founder taps at a layout their own phone users never see, at a scale where a password field is a few pixels tall. So the **login window** follows the device: `BROWSER_SANDBOX.loginViewports` holds two shapes, and the client sends a *name* from that closed set. Nothing a client sends becomes a number on Chromium's command line, and the service normalises an unrecognised hint to desktop rather than failing a scan over it.

The **analysis** does not follow the device. `connectReadOnly` puts every page back to `BROWSER_SANDBOX.viewport` before it reads anything, because a mobile layout hides its navigation behind a menu: a phone-started scan would harvest fewer links and find fewer surfaces, and two scans of one product would stop being comparable depending on which device happened to start them. That override is best effort and never fatal — a browser that refuses it still holds a signed-in session worth reading.

No image rebuild: the screencast ceiling only *limits* a frame, it never upscales one, so a narrow window simply arrives narrow. The dialog's box is sized from the frame, so a tall phone-shaped picture gets a tall phone-shaped box for free.

## Finished is not the same as unlimited

`completeness: "partial"` rendered as **"Only partly"**, in amber, over a scan that had done everything it was ever going to do. The single reason was `mutation_blocked` — Vibe refuses every non-GET request because the session is the founder's own, and it always will. A permanent, deliberate safety property presented as a shortfall teaches a founder that Vibe half-works.

`describeCompletion` reads the reasons instead of collapsing them. Three answers, because there are three situations: nothing limited it; only Vibe's own policy or budgets did; or something went wrong. Policy and budget stay separate — "Vibe will never do this" and "Vibe stopped after 25 pages" are both deliberate, and only one is an argument about safety. Anything that is neither is treated as a failure, written as the remainder so a reason added later is a failure until someone decides otherwise.

## What a scan says about itself

A finished scan produced six notes and the panel headed all six with *"6 things Vibe could not check"*. **One** was a failure. Two were facts Vibe had established by looking, one was the page budget working exactly as designed, and two were safety refusals. A founder reading that heading learns Vibe failed six times.

So every note carries the kind of statement it is — `failed`, `by_design`, `observed` — assigned by a total map over the warning codes, so a new code has to be classified rather than arriving as whatever a default would be. The label counts failures; the rest is grouped under what it actually is. And the path travels with the note: two identical redirect sentences with nothing to tell them apart is how a correct message reads as the same message printed twice.

The same scan ended `partial` for one reason: 53 non-GET requests blocked. Most were analytics beacons, one per page view, and the result told the founder that *parts of this application may render via non-GET requests* — about requests that render nothing anywhere. Every non-GET is still refused, unchanged; what changed is what Vibe concludes from having refused it. `couldHaveRenderedPage` clears only kinds that are definitionally not page data (`ping`, `image`, `media`, `font`, `manifest`, `texttrack`); `fetch`, `xhr`, `document` and every unrecognised type stay capable, because a GraphQL POST is a `fetch` and the two errors do not cost the same. Both counts are reported, so the number does not silently shrink.

## Reading a product, not a framework

Two detectors were testing the customer's stack rather than their product.

**What a person can do.** The action selector was `button, [role=button], a[class*=btn], a[class*=button]`, and a real scan recorded one action for a whole page: *Sign out*. The page's own call to action was a `<Link>` in a utility-CSS application, whose classes describe appearance and never role. Bootstrap says `btn`, Material says `MuiButton`, CSS modules say `Button_root__x7f2`, Tailwind says nothing at all. Three layers now, weakest last: structure (`button`, submit inputs, `role=button`), then class names matched case-insensitively, then — for the case nothing else reaches — a link the page has *drawn* as a control, measured by padding plus a fill or a border, bounded to short text so a padded card stays a link.

**`plan` names two things.** A scan read `/app/projects/<id>/plan` — an Action Plan, a list of business steps — as a billing surface with high confidence, four times. A project planner, a roadmap tool, a meal planner and a travel planner all have a `/plan` and none of them sells anything there. `billing`, `subscription`, `invoices` and `credits` stay path signals on their own; `plan` must be corroborated by the page saying something about money in **its own** title or heading. Not from nav: an application shell that carries "Billing" and a credit balance on every page would otherwise confirm every path in the product as billing. And never by the word `plan` itself, which would be the same claim twice rather than a second source.

The error is allowed to point one way: a missed billing surface understates, an invented one tells a founder they have billing when the page is a to-do list, and an audit then skips a gap that is really there.

## What a label is, and what emptiness is

Two things a real scan got wrong about the pages it read correctly.

`textContent` welds a container's descendants together with nothing between them, and the snapshot stored the result: `Sign outLog out of Vibe Business`, `ProfileManage your profile`, `5,155Credits` — a visible label and the sentence underneath it, persisted as one string. The extraction now walks text nodes and joins them with a space. The trade is one-sided on purpose: a word split across inline tags gains a space it did not have, which reads fine, where the alternative loses the boundary between two sentences, which does not.

And `[aria-live=polite]` was in the empty-state selector, so `Showing 1–4 of 4 repositories` made a table with four rows in it an **empty state** — carried onward in `applicationSignals.emptyStatePresent`. A polite live region is where an application puts pagination, toasts and validation; it says "this text changes", never "there is nothing here". The selector now holds only markers an author writes *because* a thing is empty, and `sanitizePageExtraction` — the last gate before anything is persisted, which treats the script's output as untrusted — drops a label counting items that are present. The total is what decides it, not the phrasing: `0 of 0 results` is a genuine empty state in the same words.

## A screen is worth a page; a copy of it is not

`/app/projects/<a>/settings` and `/app/projects/<b>/settings` are one screen holding different rows. The first run that read pages properly inspected **25 pages and saw 8 screens** — four projects × seven workspace tabs — and then reported `integrations` and `onboarding` as *not detected*, because it had never reached `/app/connect/github` or `/app/onboarding`. That is a scan answering a question about the product with a fact about its own budget.

So `routeShape` collapses identifier segments — a UUID, a run of digits, a long hex string, a long opaque token mixing digits and letters — and `maxPagesPerRouteShape` inspects each template twice. Twice rather than once, because a second instance is often a different *state* of the same screen; that is how `empty_state` was detected in the run that prompted this. The shape is deliberately conservative: collapsing a real route would hide a surface, where an uncollapsed duplicate merely costs a page.

The check runs before the navigation, so a skipped copy costs nothing, and counts only pages actually **inspected** — a page that failed to load taught nothing and does not hold a slot. When copies are skipped the snapshot says so once, with a count.

Auth surfaces are named **once**, in `routes.ts`, and both the crawl and the sign-in probe read that list. They used to be two lists that disagreed — `NEVER_VISIT` knew login and signup, `login-detection.ts` knew reset and MFA because it had to — and a scan duly spent a page on `/reset-password` while signed in. Only the unambiguous surfaces are shared: `confirm` and `callback` stay local to the probe, because refusing `/orders/confirm` would drop a real surface while a delayed auto-start costs one poll.

A candidate that redirects onto a page already inspected is **recorded**, not dropped. `/app/onboarding` exists, was navigated to, and redirected to the dashboard because the founder is past onboarding — and the snapshot's only account of it was `onboarding: detected false, evidence: []`. "This path sent Vibe somewhere it had already been" and "Vibe found no onboarding" are different sentences.

## Noticing the login instead of asking about it

The founder used to hand the session over by pressing **I'm logged in — Analyze**. `login-detection.ts` answers that question itself: while the browser is on screen, Vibe reads four booleans out of the page — is a password field present, is a sign-out affordance present, is an account affordance present, is there an application shell — and combines them with the path.

Three properties make that safe to poll:

- **Structure, never a value.** The password check is `querySelector("input[type=password]") !== null`. It resolves to a boolean at the source, and `RawSignInProbe` has no field a credential could travel in. A test asserts the script never touches `.value`.
- **Every ambiguity resolves to _not signed in_.** Starting early spends the scan on a login page; starting late costs one button press, and the button is still there. A password field on screen holds the scan back even next to a sign-out link.
- **The probe writes nothing.** No session status, no snapshot, no usage row, no credit hold, and it never terminates a browser. It answers a question; `analyzeDeepScan` re-checks every precondition for itself.

Two consecutive positive readings start the scan, after a grace window the founder can close — a single-page application paints its shell before its session check resolves, and one reading inside that window is a plausible false positive.

## One included scan per project

`entitlement.ts` holds the product rule: **each project receives one included successful Deep Scan; additional Deep Scans are credit-gated.** Only a _successful_ scan consumes the included entitlement, start attempts are separately limited, and a failed scan does not spend the founder's one free look.

## Typed failures only

`errors.ts` is the whole set of failures a caller can observe. A raw provider error — a sandbox exception, a CDP transport error, a Playwright timeout — never escapes this module, for the same reason a raw model error never escapes `modules/ai/anthropic/`.

## What lives here

| File                               | Purpose                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `schema.ts`                        | The domain: surfaces, evidence, signals, metrics, and the versioned analyzer.            |
| `analyzer.ts`                      | One authenticated analysis: which pages, in which order, and what was learned.           |
| `routes.ts`                        | Building and ranking route candidates, and refusing the ones that must never be visited. |
| `extract.ts`                       | The in-page extraction script, and sanitizing what it returns.                           |
| `login-detection.ts`               | Whether the founder has finished signing in, and whether to start unasked.               |
| `surface-detection.ts`             | Turning extracted signals into detected application surfaces.                            |
| `read-only-policy.ts`              | The pure decision layer: which requests and events are allowed.                          |
| `budgets.ts`                       | Pages, bytes, time and concurrency. Tighter than the public crawl.                       |
| `errors.ts`                        | The typed failure and warning codes. Nothing else escapes.                               |
| `entitlement.ts`                   | One included scan per project; the rest are credit-gated.                                |
| `billing.ts`                       | Holding, settling and releasing Credits for a scan.                                      |
| `provider.ts`                      | The browser-session boundary.                                                            |
| `provider-usage.ts`                | What one session consumed, for the usage ledger.                                         |
| `playwright/connector.ts`          | Connecting read-only, and attaching the guards that enforce the policy.                  |
| `sandbox-browser/provider.ts`      | The sandbox-backed implementation of that boundary.                                      |
| `sandbox-browser/guard-program.ts` | The guard on the one public port. No interpolation, by test.                             |
| `sandbox-browser/image.ts`         | Creating the browser runtime image.                                                      |
| `sandbox-browser/image-build.ts`   | The commands and hosts that build it.                                                    |
| `sandbox-browser/runtime.ts`       | The sandbox's shape: names, commands, ports.                                             |
| `sandbox-browser/tokens.ts`        | Deriving and comparing the two capability tokens.                                        |
| `sandbox-browser/client.ts`        | Resolving the configured provider, or reporting that there is none.                      |
| `service.ts`                       | Start, live view, analyze, cancel, and the access status a screen reads.                 |
| `store.ts`                         | Persistence for sessions and snapshots.                                                  |
| `view.ts`                          | Deriving the Deep Scan screen's state.                                                   |
| `test-support.ts`                  | A fake database, a fake provider, and a seeded project.                                  |
