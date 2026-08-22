# 0039 - Where truth lives, and how documentation stays current

Status: Accepted

Date: 2026-08-21

## Context

Vibe Business has shipped fifty-four sprints and thirty-eight prior ADRs. Its
three top-level documents described Sprint 0.

The measurement, taken on `main` at `bd7dc42`:

- **27 of 38 ADRs appeared nowhere in `ARCHITECTURE.md`.** Not disagreed with —
  absent. The document that exists to say how the pieces fit together had no
  reference to the sandbox provider, the approval architecture, the merge rule,
  the coding agent, the tool gateway, the credential broker or the economy layer.
- **`ARCHITECTURE.md` §5 named twelve modules; `src/modules/` holds about
  thirty-one.** Three of the twelve were README-only stubs superseded by other
  modules.
- **`ARCHITECTURE.md` §7 listed eleven open decisions, seven of which had been
  answered by an ADR** — one of them by ADR 0013, sitting in the same repository.
- **`ARCHITECTURE.md` §3.12 invented all ten of its example audit-log event
  names.** None matched `src/modules/audit-log/events.ts`.
- **`PRODUCT.md` said the core loop was not built.** The product's own landing
  page had already removed that sentence, with a code comment explaining that it
  was no longer true.
- **`docs/setup/github-app.md` instructed `Contents: Read-only`** and listed
  `Contents: Read and write` under the permissions to avoid. An operator
  following it provisions an App on which every execution and every merge fails.
- **`CLAUDE.md` rule 24 forbade introducing a background-job technology without
  a decision**, while `workflow@4.8.2` is in `package.json` and ADR 0013 is the
  decision. Rules 58 and 59 described a system without an approval architecture
  and without a sandbox.
- **Three pre-install screens promised the customer "Read-only access to
  start."** Execution creates blobs, trees, commits and refs; an approved merge
  fast-forwards the default branch. Sprint 0032 found this, wrote it down as an
  open risk, and left it — for twenty sprints.

These are not one kind of problem, and treating them as one is why they
accumulated. They are three:

1. **A statement that misleads a customer.** The read-only promise.
2. **A statement that breaks an operator.** The setup document.
3. **A statement that misdirects a future author.** Every rule in `CLAUDE.md`,
   because rule 1 binds each AI session to `PRODUCT.md` and `ARCHITECTURE.md`
   before significant work. An agent obeying those documents would refuse
   correct work, or "fix" working code back to a state an ADR had already
   replaced.

The third is the one that compounds. Documentation drift in most projects costs
a reader some time. Here the documents are an input to the process that writes
the code, so a false sentence is closer to a poisoned test fixture than to a
stale comment.

What they share is the mechanism: **nothing in this repository fails when a
document stops being true.** Lint does not. `tsc` does not. Five thousand tests
do not. The build does not. Sprint 0032 is the proof that noticing was never the
missing ingredient — it noticed, recorded the finding precisely, and the finding
sat there because recording it created no obligation and no failure.

A second, quieter cause sits underneath: **there was no agreed answer to where a
given claim belongs.** `ARCHITECTURE.md` §3.11 described the credit layer; so did
ADR 0024, which contradicted it; so did `docs/business/CREDIT_ECONOMICS.md`,
whose numbers `ECONOMY_MODEL.md` later corrected by two orders of magnitude
without either file referencing the other. When four documents may all describe
one thing, none of them is wrong to, and all of them rot.

## Decision

### 1. Every claim has exactly one authoritative home

| Claim | Owner |
|---|---|
| Why a decision was made, and what it forecloses | the ADR |
| What a module does and how its files fit together | that module's `README.md` |
| The database schema | `supabase/migrations/` |
| What was built in a sprint, what it cost, what it failed to prove | that sprint's record |
| Product scope, the user, the flow, the non-goals | `PRODUCT.md` |
| How the pieces fit together, and where each decision is recorded | `ARCHITECTURE.md` |
| What is known to be missing | `docs/ROADMAP.md` |

Other documents may reference an owner. They may not restate it in a form that
can drift independently. A number that appears in two places will disagree; the
only question is when.

### 2. A document's tense is part of its contract

Two kinds, and mixing them is what made the drift invisible.

**Records** — `docs/sprints/`, `docs/decisions/`, `docs/audits/`,
`docs/PROJECT_HISTORY_AND_LEARNINGS.md` — say what was true when they were
written. They are not edited to match the present, and a record contradicting
HEAD is working correctly. A record is corrected only when it was **wrong when
written**, and then only in the open: a dated bracket that leaves the original
standing, never a silent replacement. Sprint 0037's "bounded at 3" is the worked
example — `git log -S` shows the value was 10 in that sprint's own commit, so it
was never true, and it is now marked as such rather than quietly changed to 10.

**Current-state documents** — `README.md`, `PRODUCT.md`, `ARCHITECTURE.md`,
`CLAUDE.md`, `docs/README.md`, `docs/ROADMAP.md`, `docs/setup/`,
`docs/deployment/`, and every `src/modules/*/README.md` — describe the system as
it is at HEAD.

### 3. A false sentence in a current-state document is a defect

With the standing of a failing test, not of a nit. It is not "documentation
debt", it is not deferred to a cleanup sprint, and it does not need a separate
ticket. The change that made it false is the change that repairs it, and the
change is not complete until it does — which is `CLAUDE.md` rule 83.

This is a claim about *class*, not about severity. A wrong sentence in a setup
document breaks an operator; a wrong sentence in `CLAUDE.md` misdirects every
subsequent session. Neither is cosmetic, and calling either one cosmetic is how
both survived fifty sprints.

### 4. Currency is enforced by an executable list, not by review

Review found this drift. Review found it in Sprint 0032 too, and it changed
nothing, because a finding without a failing check is a note.

`src/lib/docs/documentation-currency.test.ts` fails the build on the structural
half:

- every sprint record is linked from the sprint index, and no index row points at
  a missing file;
- every ADR has an index row whose number matches its filename, and no number is
  used twice;
- every relative Markdown link in the root and in `docs/` resolves;
- every ADR number appears in `ARCHITECTURE.md`;
- a retired claim does not reappear in the current-state file it was retired
  from.

The last of these is the forcing function, and it is deliberately **scoped per
file**. A repository-wide substring ban would be wrong, not merely
inconvenient: Sprint 0032 quotes the read-only defect as the thing it found, and
ADR 0024 quotes `ARCHITECTURE.md`'s credit sentence as the state it supersedes.
**History may say it; a current-state document may not.** That distinction is
the assertion's design.

### 5. The test asserts structure, and says so

It cannot tell whether a sentence is true. A Decision Index row can name the
wrong layer and stay green; `RETIRED_CLAIMS` holds the drift this sprint found
and is silent about drift it missed. Stating that in the test's own docblock is
what keeps a green suite from being read as a guarantee of accuracy — the same
discipline rule 66 applies to `sandbox_validation_passed`.

### 6. `ARCHITECTURE.md` is a map and an index, never a second copy of the ADRs

It carries the shape, the flow, the module boundaries, the cross-cutting
concerns, and one line per decision pointing at the ADR that owns it. It does not
carry a chapter per layer. Fourteen layer chapters would duplicate what module
READMEs, ADRs and sprint records already hold — four places to keep in sync
instead of two, manufacturing exactly the drift this ADR exists to end.

The Decision Index is the mechanical half of that, and it is what makes the
"every ADR is mentioned" assertion affordable. Without an index, that assertion
demands twenty-seven ADRs be worked into prose and is unpayable. With one, it
costs two lines per future ADR and converts a silent permanent decay — the
fortieth ADR would have been invisible too — into an obligation something checks.

### 7. `ARCHITECTURE.md` §7 is a register of open *decisions*, and nothing else

Work that is decided but not built is not an open decision. Conflating them is
how seven answered questions sat in §7 for months looking like live debate.
Unbuilt work belongs in `docs/ROADMAP.md`.

### 8. The roadmap records gaps that cite evidence, never intentions

`docs/business/README.md` already bans placeholder documents — "a list of
intentions pretending to be documentation". A roadmap is the natural place for
that failure, so its constitution is stated in its own header and is
structural:

- every entry cites something that exists — a file path, a measured number, an
  ADR, or a "what has not been proved" line from a sprint record;
- entries are phrased as what is currently untrue or missing, never as a feature
  to build;
- entries leave the file two ways, done or dropped with a stated reason, never by
  silent deletion;
- no dates and no estimates. The order is an argument about dependency.

The citation rule is what the link assertion then guards for free: an entry whose
evidence path is deleted fails the build.

### 9. Rule numbers in `CLAUDE.md` are immutable; rules are rewritten in place

Numbered rule references run to roughly 380 occurrences across `src/` and
`docs/`. Renumbering would silently re-point every one of them, and **nothing
would fail** — the worst failure mode available. A rule whose premise is false is
rewritten under its own number. A rule that is fully superseded keeps its number
and says so. Deleting a rule and shifting the rest is forbidden.

## Consequences

**Easier.** A reader can trust a current-state document, which is the only thing
that makes reading one worthwhile. An AI session bound by rule 1 is given the
system that exists rather than the one planned. A new ADR is visible from the map
by construction. A claim that drifts has one place to be fixed, because it has
one place to live.

**Harder.** Every sprint now carries a documentation obligation it could
previously defer, and a change touching a documented boundary is not finished
when the tests pass. `RETIRED_CLAIMS` must be extended by hand whenever a claim is
retired, which is a judgement about what will regress rather than a mechanical
step. Records may not be tidied, so this repository will always contain sprint
documents that contradict HEAD, and readers must understand why that is correct.

**Foreclosed.** A layer chapter in `ARCHITECTURE.md` that restates a module
README. Renumbering `CLAUDE.md`. Silently editing a sprint record. A roadmap entry
that is an intention. A "documentation cleanup" sprint as a category — the work
is now attached to the change that creates it.

**Deliberately still open.** Whether module READMEs become mandatory. Eleven
modules have none, and the test does not assert their presence, because a README
written to satisfy a test is the placeholder document `docs/business/README.md`
bans — and asserting presence would bless three dead stub directories rather than
retire them. Whether prose accuracy can ever be checked mechanically; nothing
here attempts it. Whether `RETIRED_CLAIMS` should be co-located with the code that
would regress it rather than centralized. Whether the duplicated sprint number
0054 is worth repairing, given four documents link to one of the two.

## What this decision does not establish

It does not establish that the documents are now true. It establishes where each
claim belongs, which tense each document is written in, and what fails when the
structural half of that drifts. Everything asserted here about prose rests on one
pass of human verification against the code, on one commit, and will decay the
moment nobody repeats it — which is precisely the reason the structural half is
executable instead.
