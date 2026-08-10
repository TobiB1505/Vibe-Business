# ADR 0010 — Safe Outbound HTTP Inspection

Status: Accepted
Date: 2026-08-10
Context: Sprint 3 — Live Product Intelligence

## Context

Sprint 3 introduces the first feature where **Vibe Business makes outbound HTTP requests to a destination a user controls**. Until now every outbound call went to a provider we chose (GitHub, Supabase). A user-supplied production URL is categorically different: it is untrusted input that decides where our server connects.

That makes Server-Side Request Forgery (SSRF) a first-class architectural concern rather than an implementation detail. Vibe Business runs as a server-side application with network reachability that its users do not have — cloud instance metadata endpoints, private VPC ranges, internal service addresses. Without a boundary, "inspect my website" becomes a request to fetch anything our server can reach and show the user the result.

This will not be the last feature that fetches a user-supplied URL. The decision therefore needs to be architectural, not local to one crawler.

## Decision

**All outbound HTTP to user-supplied destinations goes through one safe-fetch boundary** (`src/modules/live-product-intelligence/net/`). No other code path may open an outbound connection to a user-controlled address.

The boundary enforces four steps, in order, for the initial request **and independently for every redirect hop**:

1. **URL policy** — HTTPS only; no embedded credentials; no internal hostname shapes (`localhost`, `*.local`, `*.internal`, single-label names).
2. **DNS resolution** — the hostname is resolved to concrete addresses via the OS resolver, so `/etc/hosts` and search domains are visible to validation rather than invisible to it.
3. **Address gate** — **every** resolved address must be publicly routable. Loopback, private, link-local, unique-local, CGNAT, multicast, reserved, documentation ranges and cloud metadata endpoints are rejected, across IPv4 and IPv6, including IPv4-mapped and NAT64-wrapped forms. An address that does not parse as a strict literal is treated as unsafe, never as public.
4. **Pinned connection** — the request is made to the exact address that just passed validation, while `Host` and TLS SNI still carry the real hostname.

Three consequences of that design are load-bearing and deliberate:

- **Step 4 is what makes step 3 meaningful.** If the HTTP client resolved the hostname itself, an attacker's DNS server could answer "public" for our check and `127.0.0.1` for the connection milliseconds later. Pinning removes the second lookup, closing the DNS-rebinding window rather than narrowing it.
- **Redirects are never delegated to the HTTP client.** Automatic redirect following would perform an unvalidated request to a destination we never checked. Redirects are followed manually, one hop at a time, re-entering the pipeline at step 1, under an explicit hop limit.
- **A mixed DNS answer is rejected outright.** If a hostname resolves to both a public and a private address, we do not "pick the safe one" — a host that resolves that way is not a legitimate public website, and selecting the public address would let the private one through on a subsequent lookup.

The implementation uses `node:http`/`node:https` rather than `fetch`, because address pinning, redirect suppression, and streaming byte limits are all unavailable through `fetch`'s supported API surface.

`DnsResolver` and `HttpTransport` are ports, so the entire boundary is testable with in-memory doubles and CI never touches the network.

## Consequences

**Positive**

- One reviewable place enforces the whole threat model; a future feature that fetches user URLs inherits it by construction.
- The guard is provably tested: the suite asserts blocked destinations produce **zero** transport requests, so a "block" is a request never made rather than a response discarded.
- Byte limits are enforced while streaming, so an enormous or endless response cannot exhaust memory.

**Negative / accepted trade-offs**

- **No localhost or development escape hatch.** Developers cannot point the feature at a local dev server. Accepted deliberately: an exception would weaken the exact check that stops SSRF, and the feature analyses live public products.
- **HTTPS only.** A product served over plain HTTP cannot be inspected. Accepted: an HTTP origin leaves every redirect and response open to tampering, and permitting it invites `http://127.0.0.1`-shaped input.
- **Node-specific.** The transport adapter is tied to Node's HTTP stack. Contained behind the `HttpTransport` port, so an Edge-runtime implementation would replace the adapter, not the boundary.
- **Legitimate sites behind mixed DNS answers are refused.** Rare, and preferred over a weaker rule.

## Alternatives considered

- **String-based blocklists only** (reject `localhost`, `127.*`, `169.254.*` as text). Rejected: trivially bypassed by `0177.0.0.1`, `2130706433`, `::ffff:127.0.0.1`, or any hostname that simply resolves to a private address. String checks are kept as a cheap first filter, never as the defence.
- **`fetch` with `redirect: "manual"`.** Handles redirects acceptably but cannot pin the connection address, leaving DNS rebinding unmitigated.
- **An outbound HTTP proxy allowlist.** Stronger in principle, but introduces infrastructure this project has not decided on (ARCHITECTURE.md §7) and is disproportionate to V0.1.
- **A headless browser** (Playwright/Puppeteer). Rejected for Sprint 3 on scope grounds and because it would massively widen the outbound attack surface — a browser executes untrusted JavaScript that can itself initiate requests. See Sprint 3 §37.

## Related

- [ADR 0006 — Untrusted Repository Execution](0006-untrusted-repository-execution.md) — the same "untrusted input is data, never behaviour" principle, applied to repository contents.
- [ADR 0008 — Secrets Management](0008-secrets-management.md) — why typed errors never carry raw upstream responses.
- [docs/sprints/0003-live-product-intelligence.md](../sprints/0003-live-product-intelligence.md) — the sprint that introduced this boundary.
