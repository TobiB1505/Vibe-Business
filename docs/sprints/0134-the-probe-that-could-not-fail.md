# 0134 — The probe that could not fail

Date: 2026-09-03
Branch: `claude/agent-preview-diff-logic-sxj5uc`
Decision: [ADR 0080](../decisions/0080-the-probe-that-could-not-fail.md)

## What this was for

[Sprint 0133](0133-the-profile-that-decorated.md) ended with two things named as open and one of them recorded as impossible: Vite's `allowedHosts` behaviour was to be settled by dogfooding a Vite preview, and there was no Vite row, so there was no preview to dogfood. The founder was not ready to dogfood anyway. So the question was settled by reading instead.

## The finding

The health check ran `curl http://127.0.0.1:3000/` inside the sandbox. That instinct was right and is untouched: probing over loopback keeps every byte of an untrusted response inside the microVM, so there is nothing to sanitize because nothing arrives.

**What nobody had checked is whether that question can be answered "no".** From Vite's shipped source, in this repository's own `node_modules`:

```js
if (extracted.type === "ipv4" || extracted.type === "ipv6") return true;
if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
```

Every IP literal is allowed unconditionally. A loopback probe is not merely unlikely to catch a host gate — it is **unable** to. And the refusal it would have needed to see is `403`, which `healthyStatusCode` counted as healthy along with everything else from 100 to 499. Two independent halves, either of which alone would have hidden it.

**It was live.** ADR 0078 shipped `astro_dev_v1` while holding Vite back for exactly this reason, and Astro *is* a Vite server — so are Nuxt and SvelteKit. Every Astro preview since then could have recorded `running` for a page answering "Blocked request." to everyone who opened it. Nobody ran one, so nobody found out; that is luck, not a defence.

## Shipped

**The server learns its own hostname.** Vite reads `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` from its environment, comma-separated, discarded only for `\`, `"` or `'` — characters a hostname does not contain. So Vibe names the host it issued itself and **no file in the customer's tree is edited to make Vibe's preview work**.

That narrows a rule rather than breaking one. The call site said *no additional environment*, so there would be exactly one place a secret could enter; the reason survives, because this value is public by construction, sits beside the `--port` it resembles, and is derived at the call site so no caller can substitute another.

**The probe carries the same hostname.** One header on the same loopback request. Nothing leaves the VM, which is why the module's security argument survives word for word while the check stops being unfalsifiable. It needed the public origin *before* the server starts, where it had been fetched only after a healthy probe — `sandbox.domain(port)` is available as soon as the sandbox is, so a missing route is still the provider's failure, just classified before a server is started for a URL that would never exist.

**A 403 is investigated rather than counted.** It is genuinely ambiguous — an application behind authentication answers it to everyone, and failing that preview would be Vibe substituting its opinion for a liveness check, the mistake the 404 rule already refuses. So the two are told apart by asking twice, with the hostname and without: different answers mean the *name* was rejected. Only the failure path pays for the second request, and **no body is read** — the block page is untrusted text and stays discarded.

**Vite gets a row, last.** Astro, Nuxt and SvelteKit all declare `vite` beside their own id, so any earlier position would start the bare binary for an application that has a framework-aware server — working, serving the wrong thing, never looking like a bug. SvelteKit needs no row of its own: its binary *is* `vite`.

## What the tests had to learn

Five assertions existed to pin Vite's absence, and rewriting them is the change, not a chore. The one worth keeping is the inversion: `PREVIEWABLE_FRAMEWORKS` still does not contain `sveltekit`, and SvelteKit still resolves to `vite_dev_v1` — the property is that keying on *frameworks* covers a framework with no row of its own.

**The fake sandbox had to learn the gate**, modelled from what Vite actually does rather than stubbed to a code: a probe carrying `Host:` is refused, one without is not, because the real check lets every IP literal through. A double that answered both alike could not test the defect. It reads the header off the command, so a probe that stopped sending it would stop seeing the gate — which is the regression that matters.

And the case that must not move: an application answering 403 to *everyone* is still a healthy preview.

## What this does not prove

**No Vite preview has started in a real sandbox** — not the binary resolving in `node_modules/.bin`, not the environment variable taking effect, not a cold Vite compile inside the health budget. This does not remove the dogfood; it makes the dogfood able to produce a wrong answer instead of a reassuring one.

**Depending on an underscore-prefixed variable is a bet**, and it is recorded as one. Vite does not promise `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`. What makes it acceptable rather than hidden is that its failure mode is now `preview_host_rejected` — loud, named, with the config line in the copy — instead of a preview that lies.

**Nothing was measured.** No preview ran, so there is no timing for a Vite cold compile against the 180-second budget, and the budget was chosen for Next.js.

The migration is applied and **verified by reading the constraint back**, not by trusting a `success` reply: the predicate now names six profiles, verbatim, with every historical value still legal. Its filename was renamed to the version MCP assigned, so the next `db push` does not find it pending — the consequence [Sprint 0130](0130-the-browser-we-own.md) recorded.

Domain 7,685 · SQL 312 · browser 486 · lint 0/0 · build green. One pre-existing flake in `business-audit.spec.ts` ("keeps every desktop planet on one consistent footprint") failed in the full parallel run and passed on a re-run in isolation; it flaked once earlier in the same session and this change touches nothing in that screen.
