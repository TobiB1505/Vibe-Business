# DOCUMENTATION CURRENCY — the documents catch up, and something starts failing when they drift

**Status: implemented, not merged. No product behaviour changed.** No migration, no schema, no new dependency, no AI call, no money spent. The diff is documentation, three lines of customer-facing copy, four code comments, and one new test file.

## The problem

Vibe Business had shipped fifty-four sprints and thirty-eight ADRs. Its three top-level documents described Sprint 0.

That is not a tidiness complaint, and the verification pass found three distinct reasons why.

**A customer-facing trust claim was false.** `/login`, `/signup` and `/app` promised **"Read-only access to start"** — shown *before* the user installs the GitHub App. Execution creates blobs, trees, commits and refs (`src/modules/execution/github/adapter.ts`), and an approved merge fast-forwards the default branch (`src/modules/merge/github/adapter.ts`), both gated on `contents === "write"`. Sprint 0032 found this, wrote it down precisely as an open risk, and deliberately left it — because correcting it "would require asserting something about the production App's real configuration that no file in this repository establishes." It stood for twenty sprints.

**A setup document provisioned a broken installation.** `docs/setup/github-app.md` instructed `Contents: Read-only` and listed `Contents: Read and write` under the permissions to avoid. An operator following it gets an App on which every execution and every merge fails.

**And CLAUDE.md rule 1 binds every AI session to PRODUCT.md and ARCHITECTURE.md before significant work** — documents that said implementation had not started, the sandbox provider was undecided, the credit ledger did not exist, and that no background-job technology could be introduced (rule 24) while `workflow@4.8.2` runs in production under ADR 0013. An agent obeying them would refuse correct work, or "fix" working code back to a state an ADR had already replaced.

The product's own landing page was more current than its source of truth: `src/app/page.tsx` carries a comment recording that it removed the sentence "the core loop described in `PRODUCT.md` is not built yet" because it is no longer true — while PRODUCT.md still made the claim.

The measurement, on `main` at `bd7dc42`: **27 of 38 ADRs appeared nowhere in ARCHITECTURE.md.** §5 named twelve modules where about thirty-one exist. §7 listed eleven open decisions, seven of which an ADR had already answered. §3.12 invented all ten of its example audit-log event names.

## Why it accumulated, which is the part that matters

Not because nobody noticed. Sprint 0032 is the proof: it noticed, recorded the finding exactly, and the finding sat there.

**Nothing in this repository failed when a document stopped being true.** Lint did not. `tsc` did not. Five thousand tests did not. The build did not. A finding without a failing check is a note, and notes are what fifty sprints of drift are made of.

So this sprint corrects the documents, and leaves behind a test that fails when the structural half drifts again.

## Changes, in the order they landed

Ordering rule: a commit landed earlier the more likely a reader was to **act** on the false text. Nothing in the first seven depends on anything later, so the sprint could have stopped after any of them and left the repository more true than it found it.

1. **`Contents: write` in the setup doc.** One commit across `docs/setup/github-app.md` and `ARCHITECTURE.md` on purpose — splitting them would leave the repository self-contradicting for a commit, which is the state the commit exists to end. `Pull requests` stays on the do-not-set list with the real reason: Vibe pushes refs and fast-forwards, and opens no PR. Also new: a "read access alone is not enough" paragraph, and a section on approving a changed permission on an existing installation.
2. **The pre-install screens stop promising read-only access.** Follows the pattern Sprint 0032 chose for its own new copy — **describe behaviour, not the grant**: *"Changes land on their own branch"*, *"Nothing merged without your approval"*. Both are true regardless of what the installed App holds, which is what lets this commit avoid the assertion Sprint 0032 correctly refused to make.
3. **Rule 24 rewritten.** Its three call sites all invoke it to mean *do not add a scheduler or cron without a decision*, which stays correct; only its premise was false. It now records that durable background execution is decided (ADR 0013) and forbids introducing a *further* background technology beside it.
4. **Rules 58 and 59 rewritten.** 58 against the approval architecture that now exists (rules 67, 70, 71; ADR 0018, ADR 0019). 59 into the residual rule 61 does not state — rule 61 governs where customer code *executes*, and nothing stated that Vibe never holds a working copy of customer source in its own runtime. **That claim was verified before it was written**: `validation/vercel/provider.ts` passes `source: { type: "git" }` to `Sandbox.create`, so the clone genuinely happens inside the microVM.
5. **The execution and github module READMEs.** `execution/` asserted an ADR-0006 property it no longer holds; it is the module that *writes*, and what it never does is *execute* repository code — a different guarantee, and the one ADR 0006 actually makes. `github/` had three of four claims false, and was missing `installation-token.ts`, `repository-reader.ts` and `errors.ts` from its file list.
6. **Three built modules stop describing themselves as boundaries reserved for later.** `execution-contract/README.md` said "the FUTURE Coding Agent … does not exist. Core-4 builds it." `src/modules/coding-agent/` is roughly fifty files. `audits/`, `previews/` and `usage/` are left accurate, but each now names what superseded it.
7. **README.md.** Status, the full command block (it was missing `test:e2e`, which CI runs, plus the `db:` and probe/dogfood scripts), a documentation index, and a "Current state" section that says what is deliberately not built.
8. **PRODUCT.md.** Execute and Measure marked built; the **Plan** stage added, which the stage model was missing entirely. Two judgement calls: §12's usage-field list is a product sketch, so it is mapped onto the four real ledgers plus the separate Credit ledger rather than deleted; and "preview deployment" becomes "temporary isolated preview", because ADR 0016 rejected deploying, not previewing.
9. **ARCHITECTURE.md rebuilt.** The preamble's confirmed-versus-deferred axis was right when nothing was built; the axis that matters now is decided-and-built / principle / genuinely open. §2 replaces nine invented stages with the sixteen the code runs. §6 stops enumerating entities and declares `supabase/migrations/` authoritative, because a hand-kept table list is wrong at the next migration. §7 keeps four genuinely open decisions and strikes seven through with the ADR that resolved each. **New §8 Decision Index**: every ADR, one line, plus stubs for the ten layers with no section.
10. **The numbers four documents state about their code.** Detailed below.
11. **The two architecture reviews, ADR 0039, rule 83, and this record.**

## The correction that needed different handling

`docs/sprints/0037-billing-core1-credits-ledger.md` says contention retries are "bounded at 3". `git log -S"HOLD_ATTEMPTS = "` returns exactly one commit — `b69c5ba`, that sprint's own — where the value is **10**.

So it was never true. It is an error in a record, not drift, and the two need opposite treatment: drift in a current-state document is repaired, while a record that was wrong when written is **corrected in the open**. It now carries a dated bracket naming the commit and the command, with the original sentence left standing.

## The numbers, corrected

- `credits/schema.ts` explained the absent cache SKU by saying the adapter does not report cache usage and `ai_usage_events` has no column for it. Both are false — the columns were added by `20260818210000_agent_execution.sql` and `ai/usage.ts` writes them on every agent turn. The decision to omit the SKU stands, for a narrower reason: `projection.ts` re-prices from input and output alone, so metering cache without pricing it would meter something nothing charges for. That is a gap, and it is in `docs/ROADMAP.md` rather than closed by quietly widening a list.
- `credits/service.ts` still described itself as shadow mode, called by nothing in production. Billing Core 2 wired it: `operation-billing.ts` calls reserve, settle and release, and `operations/billing.ts` wraps every durable operation start path. What is still inert is one level up and is a *pricing* fact — `CREDIT_RATE_CARDS` is empty, so `retailChargeFor` returns null and the path runs with nothing to hold.
- `execution-contract/budget.ts` opened with "Vibe has never run an agent". Runs #3–#8 have since happened and are measured. The ceilings held — six runs at $0.1444–$0.3465 against a $3.00 ceiling — and are **deliberately not retuned**, because a ceiling that tracks the observed maximum stops bounding anything.
- `economy/credit-rate-card.ts` said 6 runs × 3 models, 18 rows. `HISTORICAL_RUNS` holds 7 and the file's own test asserts 21.
- `CREDIT_PRICING_V1.md` names `analyzeClassCostDifferentiation()` and `simulateAllHistoricalRuns()` directly above tables that no longer match what those functions return. **The tables are frozen at the six-run dataset on purpose** — freezing them is what keeps the document's argument checkable against the sprint that made it — but nothing *at the table* said so, so a reader checking one against the code finds n=6, mean $0.3125, 21 rows, and concludes something is broken. Both tables now carry their own dataset and the recomputed figures. The test's stale prose ("5-vs-1", "$0.30556") is corrected to match what it actually asserts.
- `CREDIT_ECONOMICS.md` had zero references to `ECONOMY_MODEL.md`, which corrects two of its numbers by large margins. The body stays unedited, as its own status paragraph promises; the pointer goes above it.
- `repository-intelligence/README.md` omitted the `brand` detector; `live-product-intelligence/README.md` omitted `brand`, `robots`, `sitemap`, `errors` and `human-view`.

## The recurrence guard

`src/lib/docs/documentation-currency.test.ts` — a test-only file, house style, structured on `src/modules/economy/isolation.test.ts`: `process.cwd()`-rooted paths, a recursive walk, per-file failure messages, and a guard-on-the-guard asserting the walk found what it should.

| Assertion | What it prevents |
|---|---|
| Every sprint record is linked from the index, and no row points at a missing file | Three records were invisible when this was written |
| Every ADR has an index row, its heading number matches its filename, no number is used twice | A silent ratchet |
| Every relative Markdown link in the root and `docs/` resolves | 457 links; also how a ROADMAP entry whose evidence path is deleted gets caught |
| A retired claim does not reappear in the file it was retired from | The forcing function |
| Every ADR number appears in ARCHITECTURE.md | 27 were absent |

**The retired-claims assertion is scoped per file, and that is its design rather than a shortcut.** A repository-wide substring ban would break this repository on exactly the documents that are working correctly: Sprint 0032 quotes the read-only assurance as the defect it found, and ADR 0024 quotes ARCHITECTURE.md's credit sentence as the state it supersedes. **History may say it; a current-state document may not.**

**Assertion E and the Decision Index are one decision, not two.** Alone, E forces twenty-seven ADRs into prose and is unaffordable. Paired with a mechanical §8 index it costs two lines per future ADR, and converts a silent permanent decay — the fortieth ADR would have been invisible too — into an obligation something checks.

Deliberately **not** asserted, and stated in the test's own docblock: module README presence (eleven modules have none, and a README written to satisfy a test is the placeholder document `docs/business/README.md` bans — asserting presence would *bless* the three dead stub directories); no-duplicate sprint numbers (0054 is used twice, and fixing it means renaming a file four documents link to); anchor validation (a slugifier disagreeing with GitHub's would fail links that work); doc-to-code numeric couplings, which belong beside the code they describe; and **that any prose is true**. Saying that last one out loud is what keeps a green suite from being read as a guarantee of accuracy.

## Two things the sprint refused to do

**Renumbering CLAUDE.md.** Numbered rule references run to roughly 380 occurrences across `src/` and `docs/`. Shifting numbers would silently re-point every one of them, and **nothing would fail** — the worst available failure mode. Rules 24, 58 and 59 were rewritten *in place*; rule 83 was appended. Nobody should propose a tidy-up later.

**Preserving the sprints README's `## Format` spec.** It sat *inside* the `## Status` list, and specified Goal/Context/Scope/Non-Goals/Acceptance/Validation/Risks — dead since roughly Sprint 0035. It is replaced with the shape actually in use, and the Status list now states that it is append-ordered and must not be sorted, so nobody "fixes" it into a 63-line diff.

## Two defects this sprint's own work introduced and caught

**A citation that falsified itself.** The rewritten `github/README.md` claimed no pull request is ever opened and cited `grep -rn "rest.pulls" src/` finding nothing — a sentence that, by existing, made its own grep return a hit. Caught by re-running the three verification greps the plan named. Reworded to state the fact without embedding the string.

**A German word in an English document.** `docs/ROADMAP.md` had "abrechnete" in an otherwise English sentence. Caught by a grep for German function words across the new documents, which is now the reason that grep exists.

## What has not been proved

- **The production App's actual permissions.** Commit 1 states what the code *requires*; no file in this repository establishes what the installed App *has*. This was Sprint 0032's original objection, and it is not resolved — it is *routed around*: the new UI copy describes behaviour precisely so it does not need to characterise the grant. The setup document is correct as an instruction for provisioning a working App. Whether the existing installation matches it **was not checked**.
- **The manual gate was not run.** Creating a throwaway GitHub App from the corrected `docs/setup/github-app.md`, installing it on a scratch repository, and confirming a prepared change and a merge succeed against it — that is what would turn commit 1 from an inference into an observation, and it did not happen. No GitHub App credentials exist in this environment.
- **Accuracy of the replacements.** Assertion E checks that an ADR is *mentioned*, not that the sentence mentioning it is true. A Decision Index row can be wrong and stay green.
- **Completeness of `RETIRED_CLAIMS`.** It holds the drift this sprint found and says nothing about drift it missed.
- **Eleven modules still have no README**, measured and deliberately not asserted.
- **Sprint 0054 is still duplicated**, and 0055 is claimed only by calibration work on a branch this sprint does not touch.
- **The two reviews and the roadmap are unasserted prose.** Only their links are checked.

## Gate — the guard was watched failing

Every commit is green and the test landed after the fixes, so passing on arrival proves nothing. Both halves of the forcing function were made to fail locally and the failures captured verbatim.

Reintroducing `"Read-only access to start"` into `src/app/login/page.tsx`:

```
FAIL  src/lib/docs/documentation-currency.test.ts > a retired claim does not come back
      > 'src/app/login/page.tsx' no longer says: 'Read-only access to start'
AssertionError: src/app/login/page.tsx contains a claim that was retired:
"Read-only access to start".

Why it was retired: Sprint 0056 — execution creates blobs, trees, commits and
refs, and an approved merge fast-forwards the default branch. Both are gated on
Contents: write. Describe behaviour, not the grant.

If it is true again, delete the entry from RETIRED_CLAIMS in this file — that
deletion is the record. If it is not, the sentence is a defect (CLAUDE.md rule 83).
: expected true to be false
```

Deleting one row from the sprints index:

```
FAIL  src/lib/docs/documentation-currency.test.ts
      > every sprint record is reachable from the sprint index
      > links every sprint document from the index
AssertionError: These sprint records exist and no row in docs/sprints/README.md
points at them, so they are invisible to anyone reading the index:
0040a-turn-metric-mismatch.md: expected [ '0040a-turn-metric-mismatch.md' ]
to deeply equal []
```

Both changes were then discarded.

**Re-ran the three checks the work list depended on:** no call to the GitHub pulls API exists anywhere under `src/`; `HOLD_ATTEMPTS` is still 10; `CREDIT_RATE_CARDS` is still `[]`.

## Validation

lint 0 errors (15 pre-existing warnings, none new) / typecheck / **5,918 tests** / build / **312 E2E** green (run against the pre-installed Chromium: this environment ships Playwright build 1194 and the project pins 1234, so `pnpm test:e2e` cannot download its own browser here). No migration, no schema change, no deployment.
