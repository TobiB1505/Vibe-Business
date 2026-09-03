# 0080 - The health probe carries the preview's public hostname

Status: Accepted
Date: 2026-09-03

Amends [0078](0078-the-validation-profile-is-a-build-contract.md), whose "Vite has no row yet" was a decision rather than an omission, and repairs a defect that shipped with it in `astro_dev_v1`. Changes no network policy, no command source and no merge rule.

## Context

A preview's health check ran `curl http://127.0.0.1:3000/` inside the sandbox, which was the right instinct: probing over loopback keeps every byte of an untrusted response inside the microVM, so there is nothing to sanitize because nothing arrives. That argument still holds and is untouched.

What nobody had checked is whether that question can be answered "no". Vite's host check, read from the shipped source rather than from memory:

```js
if (extracted.type === "ipv4" || extracted.type === "ipv6") return true;
if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
```

**Every IP literal is allowed unconditionally.** A loopback probe is therefore structurally incapable of detecting a host gate — not unlikely to, *unable* to. Meanwhile the refusal path:

```js
res.writeHead(403, { "Content-Type": "text/plain" });
res.end(`Blocked request. This host (…) is not allowed.`);
```

And `healthyStatusCode` treated everything from 100 to 499 as healthy, 403 included. So the defect was doubled: the probe asked a question that is always answered yes, and the right question would have been graded wrong anyway.

This was not hypothetical. ADR 0078 shipped `astro_dev_v1` while holding Vite back for exactly this reason — but Astro **is** a Vite server, as are Nuxt and SvelteKit. A preview could record `running` while the founder's URL served "Blocked request."

0078's plan for settling it was *dogfood a Vite preview and decide*. That plan could not run: there was no Vite row, so there was no Vite preview to dogfood. The question could not be asked until the thing being questioned existed.

## Decision

**The probe asks the browser's question, and the server is told the answer in advance.**

### The server learns its own hostname

Vite reads additional allowed hosts from its own environment:

```js
if (process.env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS && Array.isArray(server.allowedHosts))
```

Comma-separated, discarded only if it contains `\`, `"` or `'` — characters a hostname does not have. So Vibe names the host **it issued itself**, for the process it starts, and no file in the customer's tree is edited to make Vibe's preview work. The value is public by construction and of the same kind as the `--port` beside it on the command line.

That narrows a rule rather than breaking one. The call site said *no additional environment*, and the reason was that there be exactly one place a secret could enter. The reason survives: this value is not a secret, it is derived at the call site so no caller can substitute another, and everything else still comes from the sandbox environment that is proven free of privilege before the sandbox exists. `PREVIEW_POLICY_VERSION` moves to v4 because its own docblock versions "the secret policy (none)" — and "none" now has one stated exception rather than an unstated one.

### The probe carries the same hostname

`--header "Host: <hostname>"` on the same loopback request. Nothing leaves the VM; only the header changed. That is why the security argument above survives word for word while the check stops being unfalsifiable.

This needs the public origin **before** the server starts, where it used to be fetched only after a healthy probe. `sandbox.domain(port)` is provider-derived and available as soon as the sandbox is, so a missing route is still classified as the provider's failure — just before a server has been started for a URL that would never have existed.

### A 403 is investigated, not counted

A 403 at the root is genuinely ambiguous: an application behind authentication answers it to everyone, and failing its preview would be Vibe substituting its own opinion for a liveness check — the mistake `healthyStatusCode` already refuses to make about a 404.

So the two are told apart by asking twice: the same server, the same port, one request presenting the public hostname and one presenting none. **Different answers mean the hostname was what was rejected.** Only the failure path pays for the second request, and the distinction reads no body — the block page is untrusted text and stays discarded.

`preview_host_rejected` is its own failure code because its remediation resembles nothing else here: the application is healthy, the port answers, and one line of configuration decides whether anyone can see it. The copy names that line.

### Vite gets a row, last

`vite_dev_v1`, matched after every framework-specific row, because Astro, Nuxt and SvelteKit all declare `vite` alongside their own id. With Vite anywhere earlier, an Astro application would be started by the bare Vite binary — which would work, serve the wrong thing, and never look like a bug. SvelteKit needs no row of its own: its binary *is* `vite`.

## Consequences

**A whole class of framework becomes previewable**, and the risk that held it back is now detected rather than hidden. If the environment variable ever stops working — removed upstream, an older Vite, an `allowedHosts` that is not an array — the preview fails loudly as `preview_host_rejected` instead of lying. That is what makes depending on an underscore-prefixed, unpromised variable acceptable: the failure mode of the bet is a named refusal.

**A shipped defect is repaired.** Every `astro_dev_v1` preview started since ADR 0078 carried this, and none was ever run — but the fix is not a new feature, it is a correction.

**The check now claims more than it did.** "This answered" became "this answered for the name it is reached by". It still does not prove the public edge is serving; nothing inside a sandbox can, and the product does not say it does.

**Still unproven by a real run.** No Vite preview has started in a real sandbox — not the binary resolving in `node_modules/.bin`, not the env var taking effect, not the cold compile inside the budget. The dogfood remains the thing that would show it, and this decision is what makes that dogfood able to produce a wrong answer instead of a reassuring one.
