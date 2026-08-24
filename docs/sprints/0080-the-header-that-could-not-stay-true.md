# Sprint 0080 — the header that could not stay true

Status: **One false sentence removed, and the shape that made it false banned rather than refreshed. Documentation and one test entry only — no production code, no migration.**

## The defect

`docs/ROADMAP.md` opened with:

> **Date:** 2026-08-22 · **Repository state:** `main` @ `e0a35b3`, plus Sprint 0057 on its branch

Both halves were false at HEAD. `main` was at `e49dab6`, roughly ten sprints past `e0a35b3`; Sprint 0057 had been merged long enough that all three of its records (`0057-e1`, `0057-e2`, `0057-e2b`) sit on `main`. Rule 83 names `docs/ROADMAP.md` as a **current-state** document, so this was a defect with the standing of a failing test — and it had been reported in an earlier session and left standing, which is the same failure ADR 0039 was written about: *a finding without a failing check is a note.*

The file also contradicted itself. Its own rules say **"No dates and no estimates"**, four lines under a header carrying a date.

## Why the fix is not a newer hash

The stamp is not the roadmap's invention. Three documents carry the identical format, and in all three it is correct:

| document | stamp | still true? |
|---|---|---|
| `docs/audits/2026-08-17-product-ux-audit/README.md` | `main` @ `0d33ae2` | ✅ permanently |
| `docs/audits/2026-08-21-intelligence-architecture-review/README.md` | `main` @ `bd7dc42` | ✅ permanently |
| `docs/audits/2026-08-21-economics-architecture-review/README.md` | `main` @ `bd7dc42` | ✅ permanently |
| `docs/ROADMAP.md` | `main` @ `e0a35b3` | ❌ since the next merge |

The roadmap was derived from the last two and inherited their header. That inheritance is the whole defect: rule 83's own distinction is that an audit is a **record** — one reading, at one revision, never edited afterwards, so a commit pin stays true forever — while a register is **current-state** and is rewritten every time a sprint narrows or closes an entry. A whole-file freshness stamp on a continuously edited file is false again by the next merge.

So updating the hash to `e49dab6` would have re-armed it, not repaired it. The pin is gone. What replaces it is the statement that currency lives per entry, which is what the file's first rule already demanded — *every entry cites something that exists* — and what `documentation-currency.test.ts` §C already checks by failing when a cited path stops resolving.

## What guards it now

A `RETIRED_CLAIMS` entry scoped to `docs/ROADMAP.md`, banning the label `**Repository state:**` rather than the stale value.

Proven red before green, and the red run is the part worth recording: the failure was reproduced with the **correct** current hash substituted in, not the stale one.

```
× 'docs/ROADMAP.md' no longer says: '**Repository state:**'
```

That is the assertion the sprint is actually making. A guard on `e0a35b3` would pass the moment someone typed a fresher commit and the document would decay exactly as before; a guard on the label refuses the shape.

## What this sprint does not claim

- **It does not make the roadmap's prose true.** `documentation-currency.test.ts` says so about itself at the top of the file, and this entry changes nothing about that. Every gap entry below the header is still prose no test can check, and the three audits' own stamps are untouched — they are records and correct as written.
- **It closes no ROADMAP entry.** No gap was narrowed; a false sentence about the file was removed from the file.
- **It is not evidence that the remaining `Then` entries are near.** Three of the six are not coding tasks at all — the calibration dataset needs more runs, the sandbox rates need one reconciled invoice, and cache-token metering mischarges nobody today because `CREDIT_RATE_CARDS` is empty.
