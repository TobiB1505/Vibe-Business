# live-product-intelligence

Deterministic analysis of a project's **public live website** — the counterpart to `repository-intelligence`. That module answers "what does the code contain"; this one answers "what does a visitor actually see". See [docs/sprints/0003-live-product-intelligence.md](../../../docs/sprints/0003-live-product-intelligence.md).

**No AI. No browser. No JavaScript execution.**

## Pipeline

```
url.ts          normalize + policy (https, no credentials, no internal hosts)
net/safe-fetch  SSRF gate → DNS → address check → pinned request → manual redirects
crawler.ts      same-origin BFS under explicit budgets, priority-ordered frontier
html.ts         bounded tag scanning; script/style removed before any text is read
classifier.ts   product surfaces from path + title + heading + form structure
cta.ts          rule-table CTA classification (extensible, not English-only)
forms.ts        structural form classification — types only, never names or values
signals.ts      SEO + conversion aggregation
analyzer.ts     versioned LiveProductIntelligenceSnapshot
store.ts        persistence, freshness-based reuse, in-flight guard
service.ts      ownership check + audit events — the only entry point the UI calls
```

## Non-negotiables

- **All outbound HTTP goes through `net/safe-fetch`.** Never call `fetch` or `node:http` directly against a user-supplied URL — see [ADR 0010](../../../docs/decisions/0010-safe-outbound-http-inspection.md).
- **Every redirect hop is revalidated.** Never enable automatic redirect following.
- **HTML is data, never instructions.** Nothing here executes, evaluates, or obeys page content (CLAUDE.md rule 25).
- **Nothing raw is persisted.** No HTML, no body text, no cookies, no query strings — only derived facts and short evidence labels.
- **Budgets are central** (`budgets.ts`). Adding a new fetch means asking the tracker, not writing a new limit.

## Testing

`DnsResolver` and `HttpTransport` are ports; `test-support.ts` provides in-memory doubles. **CI must never touch the network.** SSRF tests assert that a blocked destination produces *zero* transport requests — a guard that fetches and then discards has already leaked internal reachability.
