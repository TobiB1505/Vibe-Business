# The names that outlived their files

**Recorded 2026-09-02, after the work.** Etappe 5 of the plan built from the
codebase-fitness audit: documentation and ADR status. Half of what the audit
listed here was already false when I checked it, and the half that was real was
larger than it said.

## Three of the audit's findings had already been fixed or never held

Checked rather than believed, which is the only reason this is known:

- **`ARCHITECTURE.md:41` "behind a tool gateway"** — already gone. The line
  reads "in an isolated sandbox, with an explicitly named tool set", corrected
  by the change that retired the gateway (ADR 0070).
- **`ARCHITECTURE.md:45` "Visual Review" in the flow chain** — already gone. The
  line reads "Preview", corrected by ADR 0065.
- **"20 of 68 ADRs have no `Status:` line"** — a grep artifact. Every ADR has
  one; three formats are in use (`Status:`, `**Status:**`, `- **Status:**`) and
  a pattern anchored on the first misses the other two. A check that tolerates
  all three now runs, and it passes on all 71.

That is the third, fourth and fifth wrong finding from this audit. The pattern
is consistent and worth stating: it read well and it was read from a stale
checkout in two cases and from a fragile grep in the third.

## What was real, and what the audit missed

### A README naming a file that does not exist

Two were named. There were four, and two of them matter more than the two that
were.

| Where | Named | Actually |
| --- | --- | --- |
| `execution-contract/README.md` | `freshness.ts` | renamed to `live-premise.ts` |
| `projects/README.md` | `disconnect.ts` | retired by ADR 0056 |
| `product-understanding/README.md` | `src/app/pricing/page.tsx` | **never existed here** |
| `economy/README.md` | `sprint-NNNN-safety.test.ts` | a deliberate pattern, not a claim |

The third is the one worth reading twice. The README used
`src/app/pricing/page.tsx` as an illustration of what a URL path tells a model —
in a repository whose prices live in a `#pricing` section on `/` and never had a
`/pricing` route. Four days ago that exact belief, held one layer down by the
live-product classifier, produced a Move instructing the agent to build a
pricing page the product already had. The sentence now says what it meant
without naming a file, and says explicitly that whether the prices live on a
route of their own is repository structure and stays here.

### A superseded decision that says so only on the newer page

When ADR B supersedes A, B always says so — it is the first line anybody writes.
**A said nothing, in ten cases out of thirteen.** So a reader who opens ADR 0016
sees `Status: Accepted` above four sections that stopped being true when 0064
shipped, and the only record of that is a page they have no reason to open.

Rule 83 forbids rewriting a record to match the present, and this does not: the
original text stands and the status line gains a pointer, the form ADR 0027
already used for 0029. Ten added: 0006, 0016, 0017, 0018, 0027, 0031, 0033,
0061 and 0063.

Three of the thirteen were false positives, and the detector had to learn why:
ADR 0013 opens "Supersedes: nothing. Extends [0001]", 0012 with "Supersedes /
amends: none. Complements [0010]", 0030 with "Supersedes nothing. Extends
[0027]". Reading the link without reading the sentence turns each of those into
a demand for a back-reference to a supersession that was explicitly disclaimed.

### `ARCHITECTURE.md` §3.7 described a lifecycle Vibe does not have

> This layer owns branch lifecycle (create, update, discard) for execution jobs.

Wrong on all three counts as written. `merge/git-port.ts` and
`execution/git-port.ts` have no `updateRef` and no `deleteRef` **at all**, and
three tests assert their absence by reading the source. Vibe creates an
execution branch and commits to it; the one ref it ever moves is the default
branch, by fast-forward to one approved commit. Rejecting a prepared change
discards a *row* — the branch stays, because removing it is the repository
owner's to do (rule 71).

The paragraph now says that, and names it as an absent capability rather than a
policy, which is what it is.

### `docs/business/` belonged to neither family

Rule 83 sorts documentation into current-state and records, and nineteen files
were in neither, so nobody was obliged to keep them true and nobody was
forbidden from rewriting them. They are records: `ECONOMY_MODEL.md` opens by
saying it replaces figures in `CREDIT_ECONOMICS.md` and corrects two of its
claims, which is a record superseding a record rather than an edit. Rule 83 now
names the directory, rewritten in place — the rule number is immutable and did
not move.

### The test's own claim about the roadmap was false

`documentation-currency.test.ts` said module-README absence was "recorded as a
gap in `docs/ROADMAP.md` instead". It was not. It is now, with the real count
and the real sizes — thirteen modules, `operations/` at 30,602 lines the largest
of them.

## What was deliberately not done

**A check that every module has a README.** The audit asked for one, and this
file's own header had already argued against it: a README written to satisfy a
test is the "list of intentions pretending to be documentation" that
`docs/business/README.md` bans, and asserting presence would bless the dead stub
directories rather than retire them. Revisited and kept. Thirteen READMEs
written to turn a suite green is thirteen documents nobody chose to write.

The new check does the opposite job — it makes the twenty-one that exist
accurate — and the header now says which of the two it is.

## The instrument

Two checks, bringing the currency test to seven. Both catch drift *inside* a
document, where the previous five caught drift *between* documents.

The file-existence check resolves a name inside its own module first and
repo-wide second, because a README legitimately names its neighbours —
`action-plans` explains itself partly through `business-audit/conclusions.ts`.
It cannot notice a name that resolves to the wrong module's file of the same
name; `store.ts` exists seven times over. That is written into the docblock,
because a green run must not read as "every reference is correct".
