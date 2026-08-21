# Run 4 Forensic Economy Analysis

**Role for this document:** forensic post-mortem, not a calibration change. No
multiplier, threshold, pricing class, safety margin, historical weight or cost
model was changed to produce this analysis, and none is proposed as a
foregone conclusion here — see [Section 7](#7-estimator-implication). The
current `economy-model.v1` estimator is treated as a frozen baseline
throughout.

All figures below are pulled directly from `agent_execution_runs`,
`ai_usage_events`, `agent_execution_events`, `sandbox_usage_events` and the
frozen `run-N-prediction.json` snapshots, cross-checked against at least two
sources where possible (e.g. the `sandbox_stopped` event's metadata against
the corresponding `sandbox_usage_events` row — identical). Where something
could not be verified from persisted data, it is marked `unavailable` rather
than estimated.

---

## 1. Executive Verdict

**Run 4 cost $0.7014 instead of $0.3169 because the agent's implementation
was structurally larger than run 3's and run 5's** — two new files instead of
zero, 8 implementation mutations instead of 3–4, 27 provider calls instead of
11–14, and two collisions with its own verification policy along the way (one
forbidden `full_test` attempt, one `required_diff_review` skipped for
exhausting its budget). The agent did not misbehave — it worked cleanly, but
on a task that needed more new artifacts than the other two `standard` runs.

**Was that predictable?** Partially, and in a precise way: the cited evidence
id (`live.seo.structured_data_missing`) was known before the run. What the
estimator cannot currently do is distinguish that evidence id from
`canonical_missing` or `open_graph_missing` — all three collapse onto the same
surface (`seo_metadata`) and the same `single_surface` path, even though
JSON-LD structured data (a new file, a new type, typically its own test)
structurally demands more than adding one more metadata property. That is
verdict **A** below, with an important qualification made precise in
[Section 6](#6-predictability-verdict).

---

## 2. Prediction vs Actual

| | |
|---|---|
| Predicted | $0.3169 |
| Actual | $0.7014 |
| Absolute delta | $0.3845 |
| Relative error | +121.4% |

---

## 3. Cost Breakdown

| Component | Run 4 | Share | Run 3 | Run 5 |
|---|---:|---:|---:|---:|
| Model (provider) | $0.5981 | 85.3% | $0.1706 | $0.2034 |
| Agent sandbox | $0.0284 | 4.0% | $0.0176 | $0.0265 |
| Independent validation | $0.0732 | 10.4% | $0.0610 | $0.0650 |
| Infrastructure | $0.0018 | 0.3% | $0.0013 | $0.0014 |
| **Total (floor)** | **$0.7014** | 100% | $0.2506 | $0.2964 |

**Provider model spend explains the majority.** 85.3% of the total cost, and
it is the component that rose 3.5× over run 3, while validation rose only
~20% (see [4.1](#41-timeline-run-4-reconstructed-from-agent_execution_events))
and sandbox cost barely moved.

### 3.1 Provider spend decomposition

| | Run 3 | Run 4 | Run 5 |
|---|---:|---:|---:|
| Calls | 11 | **27** | 14 |
| Output tokens | 6,327 | **22,804** | 5,215 |
| Thinking tokens | 3,317 | **12,400** | 1,443 |
| Cache-read tokens (cumulative) | 175,583 | **1,014,006** | 301,859 |
| Cache-write tokens (cumulative) | 26,419 | **64,459** | 33,721 |
| Avg cost/call | $0.01551 | $0.02215 | $0.01453 |
| Most expensive single call | $0.03385 | **$0.05374** | $0.03237 |
| Sum of provider latency | 90,189 ms | **277,353 ms** | 96,018 ms |

**Direct answer to the question the sprint asked: many normal calls, not a
few extremely expensive ones.** Run 4's most expensive single call ($0.0537)
is only 1.6× run 3's most expensive call ($0.0339) — no single outlier call
explains the gap. Instead: 2.45× as many calls, each 43% pricier on average,
and a cache-read volume that grows 5.8× — the signature of a long,
self-extending conversation where every turn re-reads a growing prior
context.

---

## 4. Execution Behaviour Comparison

| Metric | Run 3 (standard) | Run 4 (standard) | Run 5 (complex) |
|---|---:|---:|---:|
| assistant_messages | 23 | **63** | 32 |
| sdk_loop_iterations | 15 | **41** | 21 |
| duration_ms (agent) | 151,587 | **365,404** | 219,954 |
| time_to_first_edit_ms | 52,782 | **166,263** | 40,563 |
| time_to_last_edit_ms | 67,356 | **266,009** | 46,819 |
| unique_files_read | 5 | **16** | 8 |
| files_read_outside_context | 3 | **13** | 5 |
| repeated_file_reads | 2 | 4 | 3 |
| implementation_mutations | 4 | **8** | 3 |
| convergence_mutations | 0 | 1 | 0 |
| required_verification_actions | 2 | **6** | 3 |
| verification_commands | 0 | 1 | 1 |
| **verification_refusals** | **0** | **2** | **0** |
| policy_decisions | 14 | **40** | 20 |
| changed_file_count | 3 | **5** | 3 |
| Agent sandbox active CPU | 71,102 ms | 73,126 ms | 110,785 ms |
| Agent sandbox wall time | 151,587 ms | 365,404 ms | 219,954 ms |

**The single most important finding in this table:** agent sandbox active CPU
for run 4 (73,126 ms) is nearly identical to run 3 (71,102 ms) — despite 2.4×
the wall-clock time. The overrun came almost entirely from **waiting on the
provider** (277s summed latency, see [3.1](#31-provider-spend-decomposition)),
not local sandbox compute. That rules out "the agent computed/compiled a lot"
and confirms "the agent ran a much longer model trajectory."

Two verification refusals occurred **exclusively** in run 4:

1. `18:24:27` — `verification_command_refused`, check `full_test`, reason
   `check_not_permitted`. The agent attempted to run the full test suite even
   though the verification plan (`mode: low`) permits only `targeted_test`
   (`forbidden: full_test, build, typecheck, lint`).
2. `18:27:41` — `verification_command_refused`, check `required_diff_review`,
   reason `diff_review_scope_exhausted`. The diff review marked **required**
   was skipped because the completion budget (`maxCompletionActions: 6`) was
   already exhausted by that point.

One more data point, stated without over-interpretation: `completion_budget_compiled`
names `maxOutsideBriefReads: 1`, while `post_edit_reads_beyond_brief` for run 4
was 3 — a policy target that was exceeded without a visible refusal event tied
to it. Whether that was inert or fed into the two refusals above cannot be
determined from the data available here; it belongs in
[Section 8](#8-instrumentation-gaps) as an open question, not a claim.

### 4.1 Timeline — Run 4 (reconstructed from `agent_execution_events`)

| Phase | Time | What happened |
|---|---|---|
| Agent start | 18:21:57 | `maxWallClockMs: 1,200,000`, `maxSdkIterations: 40` |
| Context compiled | 18:21:58 | 12 candidates available, 12 sent, `freshness: fresh` |
| First reads | 18:22:02–13 | page.tsx, layout.tsx (read twice — absolute then relative path), app-url.ts |
| Repository discovery | 18:22:13–23 | landing-contract.test.ts, robots.ts, sitemap.ts — existing SEO routes studied as reference |
| Off-scope read | 18:22:19–36 | `src/app/privacy/page.tsx` read (outside the homepage scope the evidence implies) |
| Next.js type research | 18:22:36–52 | package.json, components/layout, grepped `node_modules/next` for `export interface Metadata` |
| Test-pattern research | 18:23:20–52 | robots.test.ts, sitemap.test.ts read; grepped tests for layout imports; fonts.ts read |
| **Refusal #1** | 18:24:27 | `full_test` attempted → policy-refused |
| First write | 18:24:43 | `site-metadata.ts` created (**166s to first edit** — 3.15× run 3) |
| Further mutations | 18:24:57–19 | layout.tsx ×2, `product-jsonld.ts` created, page.tsx ×3 edited |
| Full rewrite | 18:26:09 | page.tsx rewritten in full (Write, not Edit) — last edit at 266s |
| Own test written | 18:26:22 | `product-jsonld.test.ts` — chosen by the agent, not policy-required |
| Targeted test | 18:26:25–27:40 | `pnpm vitest run product-jsonld.test.ts` — 75s gap to the model's response |
| **Refusal #2** | 18:27:41 | `required_diff_review` → `diff_review_scope_exhausted` |
| Agent finished | 18:28:08 | 63 assistant messages, 41 loop iterations |
| Branch/commit | 18:28:59 | 5 files, `vibe/agent-42070adf3cb4` |
| Sandbox stopped | 18:29:01 | active CPU 73,126 ms, egress 5,485,551 bytes |

---

## 5. Main Cost Drivers

| Driver | Evidence | Magnitude | Known pre-run? | Estimator models it? | Confidence |
|---|---|---|---|---|---|
| Two new files instead of zero | `file_written` ×2 (`site-metadata.ts`, `product-jsonld.ts`) vs. 0 in run 3/5 | implementation_mutations 8 vs. 4/3 | **Not directly** — but the evidence id (`structured_data_missing`) implied it domain-specifically, without Vibe encoding that | **No** — the `driver` vocabulary has no "expected new artifacts" concept | High |
| Long model trajectory (27 calls, heavy cache-read) | `ai_usage_events` aggregation | 3.5× cost, 5.8× cache-read | No | No | High |
| Two verification refusals | `agent_execution_events` seq 54, 109 | 2 vs. 0/0 | No — emerged during execution | No (estimator never sees verification-policy interactions) | High |
| Repository context/drift | Prediction snapshot: `driftLevel: stable`, `newRelevantCandidates: 0` | No difference from run 3 | Yes, known pre-run | Yes | High (confirmed **not** the cause) |
| Validation depth | All three runs: `standard` | No difference | Unknown pre-run in all five predictions (`expectedValidationDepth: null`) | Modelled as a constant factor of 1 | High (confirmed **not** the cause of the cost gap — validation itself cost only ~20% more, not 350%) |
| Provider/model change | All three: `claude-sonnet-5`, `pricing_version: claude-sonnet-5-introductory-2026` | None | — | — | High (confirmed **not** the cause) |

---

## 6. Predictability Verdict

**Primary verdict: A — Run 4 exposed a missing pre-execution cost signal**,
with an important qualification I do not want to blur:

What was **genuinely** known before the run is only the evidence id
`live.seo.structured_data_missing` itself — a string already present in
`evidenceIds` at prediction time. The claim "JSON-LD structured data typically
needs new code; a `<link rel=canonical>` or an `og:title` tag typically
does not" is **domain knowledge about the web format**, not an observation
from this run. So this does not use post-hoc agent behaviour to argue the
class was wrong — it uses a fact about the three evidence families that
already existed before the run.

What I am **not** claiming: that this domain heuristic is reliable enough
today to justify a formula. With n=1 per evidence family (one `canonical`
run, one `open_graph` run, one `structured_data` run), "JSON-LD costs more"
is a plausible explanation, not a proven one — it is equally possible this
particular agent trajectory happened to research unusually thoroughly,
independent of the evidence type. The two verification refusals and the long
trajectory, by contrast, are cleanly **B — irreducible execution variance**:
they emerged during execution and were not derivable from any pre-execution
signal.

**Predictable share:** not quantifiable as a percentage. I use
**"directionally predictable"** — the direction (a structurally larger change
for `structured_data` vs. `canonical`/`open_graph`) was derivable from the
evidence id; the magnitude (3.5× rather than, say, 1.5×) was not.

---

## 7. Estimator Implication

**A future v2 should investigate signal X**, with reasoning:

The estimator already reads `evidenceIds` (for surface classification and
similarity matching), but treats `live.seo.canonical_missing`,
`live.seo.open_graph_missing` and `live.seo.structured_data_missing` as
interchangeable, because all three map to the same surface (`seo_metadata`).
A future signal could distinguish, per evidence family rather than per
surface, whether that family has historically meant "property change to
existing metadata" or "new code artifact."

I explicitly do **not** justify this with n=1: a single `structured_data`
run is not a basis for a correction. **No change justified** for the current
estimator — this is an observation, not a calibration.

---

## 8. Instrumentation Gaps

Separated into what would need to exist **before** execution to be usable for
prediction, and what is **post-execution diagnostic** only:

**Prediction signals** (would need to exist pre-run):
- A per-evidence-id (not per-surface) classification of whether the implied
  change has historically meant "property" or "new artifact" — derivable from
  past runs of the same evidence id, but not seriously estimable yet at
  n=1 per family.
- No signal is proposed here that is derived solely from run 4 and then
  quietly relabelled as a pre-execution feature — that would be exactly the
  mistake this sprint was built to avoid.

**Post-execution diagnostic signals** (explanation only, never prediction):
- `verification_refusals` and their reasons are already captured and highly
  informative — but structurally only known **after** execution, so they must
  never feed the pre-execution estimate.
- Cache-read growth over the course of a run (already present in
  `ai_usage_events`) is useful for post-mortems like this one, never a
  prediction signal.
- The discrepancy between `maxOutsideBriefReads: 1` and
  `post_edit_reads_beyond_brief: 3` is a real gap: it is unclear whether that
  policy value is actually enforced or only logged. That is not an economy
  question — it is a question for `execution-context/completion.ts` this
  session did not answer, because it sits outside the analysis scope.

---

## 9. Recommendation for next calibration series

**The current economy model should stay frozen.** A correction based on n=3
comparable runs (one of them a 3.5× outlier) would be exactly the "loop
fitting itself to noise" the adjustment policy's `minSamples: 20` already
exists to prevent — correctly.

**How many more runs:** separating the 53.4% MAE figure from genuine noise
needs at least **2–3 further observations per evidence family** (i.e. at
least two more `canonical`, `open_graph` and `structured_data` runs each)
before a family-specific correction is even discussable — not twenty at
once, but meaningfully more than the current n=1 per family.

**Which class/surface combinations are most missing:**
- A second `structured_data` run, to check whether 3.5× reproduces or was a
  one-off.
- A `small`-class run with a *complete* (not `actual_incomplete`) validation
  — no `small` run has completed since the metering fix.
- At least one run that deliberately reproduces a verification-refusal
  situation (e.g. a fixture likely to exceed the `low`-mode diff-review
  budget), to see whether run 4's two-refusal pattern recurs.

---

No implementation, estimator change, or calibration was made in this
session. See [Sprint 0055's closing report](../../sprints/0055-economy-intelligence-dogfood-calibration.md)
for the calibration series this analysis follows up on, and
[docs/business/calibration/README.md](README.md) for the per-run prediction
and reconciliation record.
