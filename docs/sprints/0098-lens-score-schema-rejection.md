# CORE-2b follow-up — Business Audit Wouldn't Start

Status: Implemented

Date: 2026-08-24

## What was wrong

The first dogfood run after CORE-2b/2c shipped could not start a single
business audit. Every attempt failed at the `counting_tokens` stage —
before the paid call was ever attempted (`inference_started_at` stayed
null) — with `failure_code: "token_count_failed"`, four times over about
90 minutes on the same project. `product_understanding` operations on the
same project, in the same window, completed normally.

`token_count_failed` is `AnthropicProvider.countInputTokens`'s fallback for
any error it cannot attribute to a specific provider state (auth, billing,
rate limit, timeout, overload) — see `src/modules/ai/anthropic/adapter.ts`.
It intentionally discards the underlying diagnostic (rule 43), so the
symptom alone did not say why counting failed, only that it always did, and
only for this operation.

The cause was in `wire-schema.ts` itself. Its own header states the rule
the file is built to follow: *"no numeric or string-length constraints are
used (unsupported)"* — the Anthropic structured-outputs subset does not
support JSON Schema's `minimum`/`maximum` keywords. The lens diagnostic
score added by CORE-2b's per-lens scoring work broke that rule on the way
in:

```ts
score: {
  anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }],
  ...
}
```

The provider rejects a schema using an unsupported keyword outright, and it
does so on `countTokens` as well as on `messages.create` — unlike the
grammar-*size* budget the rest of this file's header describes, which only
the compile step for `create` enforces (`src/modules/ai/probe/`'s own
docblock says as much). That is why every audit died at the free count and
never reached inference: the request was structurally invalid before size
ever mattered. Measuring the current schema with `measureSchema` confirmed
it is smaller than the historical baseline that failed on size (4,839 B / 3
objects vs. 6,499 B / 8 objects) — ruling out the size hypothesis directly
before landing on the real one.

## What changed

Removed `minimum: 0, maximum: 100` from the lens `score` field's integer
branch. `validate.ts` already clamps the score to `[0, 100]` on the way into
the domain (`Math.max(0, Math.min(100, Math.round(raw.score)))`), so the
range was never load-bearing on the wire — it is now stated in the field's
description only, matching how the old five-dimension schema stated its own
0-100 range.

Added a red-then-green test to `wire-schema.test.ts` asserting the compiled
schema never re-introduces `"minimum"`/`"maximum"`, next to the existing
tests for the other structured-outputs subset rules (closed objects, no
optional properties). The existing rules were enforced; this one was not,
which is how the regression shipped unnoticed through lint, typecheck, the
full test suite and a build.

## What was not done

No fix to `countInputTokens`'s own diagnostic handling. It logs nothing on
a `request_rejected` classification, unlike `generateStructured`, which
calls `logRejectedProviderRequest`. That asymmetry is real and made this
harder to diagnose from production alone — but it is a separate, smaller
defect from the actual outage, and fixing it does not fix a single broken
audit. Left for a follow-up rather than folded into this one.

## What has not been proved

No live provider call was made to confirm the schema now compiles — this
session holds no Anthropic API key (rule 62/79 territory: a sandbox and a
diagnostic session are not where production credentials belong), so the
fix rests on: the file's own documented rule, the measured absence of the
keyword post-fix, and the fact that every other field in this schema
already followed the same rule and audits worked under it before CORE-2b.
The user's own next audit run against production is the real proof and
was not yet observed as this record was written.

## Validation

`pnpm lint` (0 errors, pre-existing warnings only) · `pnpm typecheck`
(clean) · `pnpm test` (6,440 passed, one more than the prior 6,439 baseline)
· `pnpm build` (succeeds). No migration.
