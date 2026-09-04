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

## Smaller budgets than the public crawl, deliberately

A real browser rendering a logged-in application is expensive in provider seconds and can contain real customer data. `budgets.ts` is therefore _tighter_ than the public crawler's, and reaching a budget degrades the result to partial rather than crawling on (rule 39).

Page content is untrusted data, never instruction (rule 36): what is extracted is sanitized into typed signals, and what is stored is derived intelligence with short evidence labels — never page source, body text, cookies or query strings (rule 37).

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
