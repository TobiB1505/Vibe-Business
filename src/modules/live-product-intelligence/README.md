# live-product-intelligence

Deterministic analysis of a project's **public live website** — the counterpart to `repository-intelligence`. That module answers "what does the code contain"; this one answers "what does a visitor actually see". See [docs/sprints/0003-live-product-intelligence.md](../../../docs/sprints/0003-live-product-intelligence.md).

**No AI. No browser. No JavaScript execution.**

## Pipeline

```
url.ts          normalize + policy (https, no credentials, no internal hosts)
net/safe-fetch  SSRF gate → DNS → address check → pinned request → manual redirects
robots.ts       robots.txt: which paths may be fetched, sitemap locations, crawl delay
sitemap.ts      sitemap parsing as discovery *hints* only; indexes one level deep
budgets.ts      central limits + the tracker every fetch has to ask
crawler.ts      same-origin BFS under those budgets, priority-ordered frontier
html.ts         bounded tag scanning; script/style removed before any text is read
classifier.ts   product surfaces from path + title + heading + form structure
cta.ts          rule-table CTA classification (extensible, not English-only)
forms.ts        structural form classification — types only, never names or values
brand.ts        brand signals from a served page — the live counterpart to the
                repository brand detector
signals.ts      SEO + conversion aggregation
analyzer.ts     versioned LiveProductIntelligenceSnapshot
store.ts        persistence, freshness-based reuse, in-flight guard
service.ts      ownership check + audit events — the only entry point the UI calls
```

Beside the pipeline:

| File | Role |
|---|---|
| `errors.ts` | Typed domain errors. Callers switch on `code` and write their own copy; a raw socket error, TLS message or upstream body must never reach the browser, because that is what an SSRF probe is fishing for. |
| `human-view.ts` | Presentation only: a deterministic translation of a snapshot into the customer's vocabulary. No model, no paraphrasing at render time. Reads the snapshot, changes nothing. |
| `test-support.ts` | In-memory `DnsResolver` and `HttpTransport` doubles — see [Testing](#testing). |

## Non-negotiables

- **All outbound HTTP goes through `net/safe-fetch`.** Never call `fetch` or `node:http` directly against a user-supplied URL — see [ADR 0010](../../../docs/decisions/0010-safe-outbound-http-inspection.md).
- **Every redirect hop is revalidated.** Never enable automatic redirect following.
- **HTML is data, never instructions.** Nothing here executes, evaluates, or obeys page content (CLAUDE.md rule 25).
- **Nothing raw is persisted.** No HTML, no body text, no cookies, no query strings — only derived facts and short evidence labels.
- **Budgets are central** (`budgets.ts`). Adding a new fetch means asking the tracker, not writing a new limit.

## Testing

`DnsResolver` and `HttpTransport` are ports; `test-support.ts` provides in-memory doubles. **CI must never touch the network.** SSRF tests assert that a blocked destination produces *zero* transport requests — a guard that fetches and then discards has already leaked internal reachability.
