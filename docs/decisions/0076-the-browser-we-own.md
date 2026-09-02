# 0076 - The browser we own: Deep Scan runs in Vibe's own sandbox

Status: Accepted
Date: 2026-09-02

Supersedes [ADR 0012](0012-authenticated-browser-analysis.md) in its choice of
provider only. Everything 0012 decided about *how* an authenticated analysis may
work — the human signs in, nothing reusable is stored, the analysis is read-only
— stands unchanged and is not restated here. Browserbase leaves; the design it
was chosen to implement does not.

## Context

The founder's ask was to run the Deep Scan's browser in a Vercel sandbox instead
of at Browserbase, on the reasoning that paying only for the sandbox is cheaper.
The first version of that plan was to reuse the **preview** sandbox, since a
person could sign in there.

That does not work, and the reason is worth writing down because it is not
obvious from outside the code. A preview runs the customer's **repository** at a
pinned commit with **no environment at all** — `provisionPreviewWorkspace`
refuses a privileged environment before it creates anything, and a test asserts
it. No database URL, no auth provider keys, no user accounts. The app renders a
login page and every login fails. There is nothing there to sign in to.

The Deep Scan does something different: it points a browser at the customer's
own `production_url` and the customer signs in with their real account. That is
what makes it valuable and it is the thing a preview cannot be.

The economics were also not what the plan assumed, and the measurement said so
before any code was written. Across all of production there are **5 browser
sessions totalling 190 seconds** and **7 analysis runs totalling 3.6 minutes**.
Per-scan browser time is close to free at any provider's rate; what costs money
is a subscription. So the saving is real only if Browserbase leaves entirely,
which is what the founder then chose.

## Decision

**The Deep Scan's browser is a Vercel sandbox Vibe creates, holding Chromium and
a guard Vibe wrote, and nothing else.** It points at the customer's production
origin exactly as Browserbase did.

`BrowserSessionProvider` did not change. That is the load-bearing fact of this
ADR: the analyzer, its read-only policy, the route budgets, the entitlement
rules and the billing all sit above the port and none of them was touched. A
boundary that survives its first provider swap was drawn in the right place.

### The sandbox holds no customer code

A third `SandboxSource` was added — `image` — meaning the base image and nothing
else. No clone, no credential, no customer filesystem. This is what makes the
rest of the decision defensible rather than a series of exceptions: the rules
that govern validation and preview sandboxes describe a hazard this VM does not
have, because there is no repository code in it to run.

### One public port, and a guard in front of it

Chromium's DevTools endpoint has no authentication and never will — the protocol
assumes loopback. Exposing it would hand full control of the browser, including
`file://` reads of the VM, to anyone who learned the URL. So Chromium listens on
loopback and a Vibe-authored guard is the only thing the outside can reach.

**Two capability tokens, because two very different callers arrive on that
port:**

- `control` is a byte pipe to CDP. Vibe's own server holds it, which is what
  lets the existing analyzer stay exactly where it is, still tested as a unit.
- `view` is the one that travels to a browser. It is **not** a pipe: it speaks a
  closed four-message vocabulary — frames out; mouse, key and wheel in — and
  translates each into one of five named CDP calls. A leaked view token can
  click and type in a browser that is already showing the owner's session, and
  nothing else.

That is strictly less than what it replaces. The old live view was a full
DevTools frontend with an address bar, embedded in an iframe that needed
`allow-scripts` and `allow-same-origin` together — the customer's signed-in
application running inside a frame on Vibe's page. What arrives now is a JPEG on
a canvas, which executes nothing.

### The tokens are derived, not stored and not random

Random was the first design and it was wrong for a reason that is a property of
the flow rather than of cryptography: **the manual-login lifecycle spans two
server requests.** The session is created in one, the person signs in by hand,
and the analysis reconnects in another — a different invocation with no shared
memory. Something has to make the token available again.

The two ways are to store it or to recompute it. Storing it puts a bearer
credential for a browser already signed into a customer's production application
into a database row — the exact artefact [ADR 0012](0012-authenticated-browser-analysis.md)
declined to hold. So it is recomputed: HMAC over the sandbox's own name, keyed by
one server-side secret that never leaves Vibe, with the purpose and the guard
version in the label so holding one token computes neither the other nor a token
for another session.

Nothing is at rest. The database holds the sandbox name, which is an identifier
and not a capability (rule 52).

### Unrestricted egress, in exactly one place, enforced by a test

A browser a person signs into cannot have its destinations enumerated in
advance: an identity provider, a CDN, a font host, a bot-check, whatever their
login form posts to. An allowlist that must contain all of that is a list
somebody maintains until the day a customer cannot sign in. So this sandbox runs
under a new `allow_all` policy.

Adding that mode to a shared union is the risk this ADR takes most seriously.
Until now the type itself was a boundary — the strictest available was
`deny_all` and the loosest was a list somebody had to write. From here the
strictest and the weakest are one keystroke apart, in a union every sandbox
caller imports.

`network-policy-scope.test.ts` is that risk's answer. It fails the build if any
file but the browser provider names the mode, if a permitted entry stops using
it, or if an entry's reason does not name an ADR. Each entry must argue **what
is in the sandbox**, not that it is safe — because egress matters exactly when
there is something to exfiltrate, and here there is no repository, no
credential, no database and no source.

Rule 64 is untouched for everything that runs a customer's code: the most
restrictive policy the provider supports, which is still `deny_all` before the
first repository-controlled command.

### Two egress windows, kept apart

A build reaches a package registry and a browser CDN under a narrow allowlist
and exposes no port. A session never reaches either — by the time a person signs
in, the image is a snapshot and the packages are on disk. Neither window is
widened to cover the other. The same separation [ADR 0029](0029-agent-runtime-placement-and-credential-broker.md)
draws for the agent, applied to a different pair.

### The image is built once, and the rebuild is read-triggered

Installing Chromium at the start of every scan would spend thirty to sixty
seconds of a person's attention on a download. So the image is a provider
snapshot, recorded in `browser_runtime_images`, keyed on the guard version — an
image built for one guard is not an image for another, and starting a changed
guard on the old filesystem produces a browser that comes up and then behaves
subtly differently, which is the worst kind to diagnose.

Nothing schedules the rebuild. The next resolve that finds no usable row builds
one. No cron, no scheduler, no queue: rule 24's "needs no new infrastructure"
met rather than argued around.

### The cost is now measured

Deep Scan was the last priced operation with no measured cost behind it — 25
Credits of revenue against a bill nobody could compute, which is exactly the
`basis: "policy"` the roadmap flagged.

`terminateSession` returned `Promise<void>` and threw the figures away at the one
moment they exist, since a running sandbox has no final wall clock. It now
reports what `stop()` measured, and `estimateSandboxCost` derives a figure under
the same rate card, the same columns and the same `cost_estimated` status the
agent's sandboxes use — so the two sum together and neither is mistaken for a
bill. `provider_cost_usd` stays null, because no provider states a price here and
overloading that column is how an assumption gets summed as a measurement.

Measured against the five real session shapes: **$0.0007 to $0.0035 per scan,
$0.0116 at five minutes**, against $0.441 of revenue. A 97–99% margin, and the
highest in the rate card.

## What this gives up

**A single-provider dependency becomes a self-built one.** The founder chose
direct replacement over running both in parallel, and the cost of that is
recorded rather than softened: if the sandbox browser fails on a real login flow
— an OAuth popup that opens a second target, a bot-check that refuses a
datacentre IP — the Deep Scan is broken and there is no fallback path. Reverting
means restoring an adapter from git history, not flipping a flag.

**The interactive view is Vibe's to maintain.** A DevTools frontend handled
scrolling, IME input, clipboard, popups and window management. A screencast plus
four message shapes does not. What it covers is a login form, which is the whole
task; what it does not cover will surface as a person unable to complete some
particular sign-in, and that is a real risk of this design rather than an
oversight in it.

**The build commands are unverified.** Downloading Chromium, installing `ws`,
resolving Playwright's revision-numbered path — none of that has run in a real
Vercel sandbox. It is asserted in shape and it is not proven, and the first real
build is where that changes.

## What this does not claim

It does not claim the sandbox is cheaper per scan. It is not, meaningfully:
190 seconds of browser time was already close to free. What changes is that a
subscription can end, and that the figure is knowable at all.

It does not claim the read-only guarantees improved. They are
[ADR 0012](0012-authenticated-browser-analysis.md)'s and they are unchanged —
mutating methods refused, downloads cancelled, off-origin navigation blocked,
nothing clicked or typed by the analyzer.

It does not satisfy rule 78. That rule is about a customer-facing **Agent**
price, and this is a Deep Scan.
