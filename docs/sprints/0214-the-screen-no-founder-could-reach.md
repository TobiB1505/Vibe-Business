# Sprint 0214 — The screen no founder could reach

Nova's thread stops describing the Agent and starts being it: all five stages
compose into the conversation, the offer to spend Credits is made there, and the
surface they replaced is deleted. No ADR — [0085](../decisions/0085-nova-is-the-project-home.md)
and [0098](../decisions/0098-design-rules-are-revisable-truth-rules-are-not.md)
already drew the boundaries this stays inside, the block registry from
[0162](0162-the-screen-nobody-had-looked-at.md) already decided that blocks
compose shipped screens rather than reproducing them, and nothing here changes
what a run may do or who may authorize one.

## What was wrong

A phone screenshot, from the founder, with a change waiting and nothing to
press.

That is where the sprint started, and the two defects behind it were both real.
`ChangeGates` matched its `stage` prop exactly, so Nova's `review_change`
moment — which mounted it at `stage="review"` — rendered the approval panel
saying *"Start a preview and look at the change first"* and filtered out the
panel that answers it. The disclosure above it, *"How this change got here"*,
was open and held only that refusal, because the validation panel had gone the
same way. And underneath it: five secondary moments, each saying *"There is a
change waiting for you to look at."*, not one of them saying which — because
nothing ages a change out of the ranking, so a month of the product is a month
of identical sentences.

Pulling on the first of those found the thing this sprint is named for.

`ChangeGates` was the review surface before the Agent workspace. The workspace
replaced every gate in it — validation, preview, review, approval, merge,
outcome, business impact — panel for panel, and `agent-stage-actions.tsx` says
so in its own comment. But the file kept compiling, because two callers still
mounted it: Nova's block, and the fixture route. So the thread, which is meant
to be the primary surface, was the last screen in the product drawing the
superseded one — and **thirty-five browser tests and six unit suites were
asserting their guarantees against a screen no founder could reach**.

That is worse than dead code. Dead code is unread. This was read constantly, by
a green suite, about a surface nobody would ever see.

## What changed, and why that shape

**The five stages compose into the thread.** `AGENT_STAGE_FOR_CHANGE` reads
`change.progress.stage` — the derivation that knew what the candidate kind could
not. `reviewGate` returns `review_required` exactly when the approval is blocked
with `approval_preview_required`, and `awaiting_approval` means the evidence is
already on screen; mapping the *kind* collapsed those two into one and sent the
first to the decision screen, which refused and named a step that had no control
anywhere. The gate control no longer carries a stage at all. `presentation="block"`
drops each stage's narrative column — the stage number, the display heading, the
paragraph restating Nova's own line — and nothing else, so changing a stage
changes the thread.

It costs no read. `validationChecks` and `mergeSummaryFor` are pure functions of
the card the block already holds, *moved* out of the server-only workspace module
rather than copied.

**The build stage streams.** `readNovaHomeData` refuses the Agent workspace read
and is right to: that read signs review images and preflights a merge against
GitHub. Two things make it affordable rather than a reversal — the expensive half
is conditional on a `resultId` a running run does not have, and the stage sits
behind a `Suspense` boundary, so Home's first paint never waits. The fallback is
`NovaAgentLive` itself, which is what the thread showed before: the file list is
on screen immediately and the run assembles around it, rather than a skeleton
pretending to be a screen.

**The last moment that sent a founder away comes home.** `ELSEWHERE` held one
entry, `execution_offered`, and its reason was a requirement rather than a
prohibition: a build is two pieces of work at two prices, and offering one of
them in a thread would be half a decision at a price the founder was not shown
the alternative to. So the thread shows both. `agentStartControls` is the one
place that builds the offer, returning two nodes rather than one tree, so the
thread cannot come to print a figure the plan page would not. `ELSEWHERE` is
empty and stays: the next moment whose decision genuinely lives elsewhere should
say so with a label rather than grow a control Home cannot honour.

**`ChangeGates` is deleted, and what only it drew moved first.** The deletion is
the point of the sprint and the order matters — deleting first and calling it a
cleanup would have made two live gaps permanent.

**The history is sorted by changes.** A founder who had run the agent eleven
times saw eleven rows headed by a timestamp, each saying `Finished` — a fact
about Vibe's machinery, not about their product. Two rows could be two attempts
at the same Move; one could have produced nothing; the row that actually changed
the product looked like the rest. `changeHistoryOutcome` says what became of each
change instead, from four reads that do not grow with the number of rows.

Two claims live in that projection rather than in the table's copy, because they
are the two this product is most able to overstate. `merged` means the default
branch points at the approved commit and Vibe read it back — never deployed,
shipped or live, because Vibe calls no deployment provider (rule 74), and a test
asserts no label uses a stronger word. And a `merging` row says the write
**stopped**, not that it failed: rule 73's ambiguous state is one a list must not
resolve.

## The two things the workspace never took

Both were missing from the *product*, not from the deleted file, and both had
been missing since the day the workspace shipped.

**The change's meaning.** The written rationale, the origin block and the Move
backlink sat above the gates and had no second call site. `ChangeOrigin` is the
one that renders for an agent change — *every* one, because
`agentic_execution_v1` has no written rationale, and its own docblock says so —
and [rule 78](../../CLAUDE.md) says the agent is the product now. So the sentence
a founder most needs before approving, *what was this for*, was on no screen in
the product. `AgentChangeMeaning` carries it, on the preview surface and the
decision surface, with the precedence unchanged.

**The code-only preview gate** ([ADR 0063](../decisions/0063-review-classification-as-a-gate.md)).
A change that alters no rendered page must not be offered a preview: serving a
page that did not change runs a sandbox nobody needs to open and spends Credits
the founder did not ask to spend. `ChangeGates` had the condition —
*"absent rather than disabled"* — and `AgentPreviewActions` never did. So every
change was offered one, while the browser test asserting the absence passed
against the deleted file.

That second one is the sprint's whole argument in miniature: a guarantee, a
test, a green suite, and a screen where the guarantee did not hold.

## What the guarantees did instead of going with the file

The fixture route mounts `AgentPreviewActions` and `AgentReviewDecision` — the
two canonical compositions the product mounts — so a panel suite still finds
every gate for a card, and finds it on live code. A change surface shows one
stage at a time behind a rail, which is why the fixture mounts both: *which*
stage a founder lands on is `agent-stages.spec.ts`'s question, and what each
panel says once it is there is these suites'.

Where a mechanism is genuinely gone, the test says what replaced it in a dated
bracket rather than disappearing. The settled-gates fold and the built-from fold
were `ChangeGates`' own; the workspace shows both unfolded, so the assertions
became *the approval is on screen with no click* and *the changed paths are
listed by the merge stage*. Eighteen tests needed only the one disclosure the
workspace does keep — the post-merge record — opened the way a founder opens it,
which is the first time those assertions have been made against a screen the
product draws.

## Two decisions the founder made

**History is sorted by changes, not by runs.** Asked directly, answered
directly, and it is the shape above.

**No lifecycle constraint.** The alternative to collapsing the change queue was
to allow only one unfinished change at a time, which would have removed the pile
by refusing to create it. Declined: a founder who wants two changes in flight is
not making a mistake, and a product that refuses on the surface's behalf is
solving its own problem with the customer's work. The collapse happens in the
view instead — one change raised, the rest counted — which is the same kind of
decision as the cap at five the view already made.

## What was not done

**The ranking is untouched.** The collapse was tried there first and
`focus.test.ts` caught it: the invariant is that everything true is either
primary or secondary, and collapsing in the ranking loses candidates. It belongs
in `buildNovaHomeView`, where the cap at five already lives.

**No new background technology, no migration, no schema change.** The history
reads rows that already existed.

**The `understand` stage is still not in the thread.** `ReviewBlock` draws three
of the five; the ready and build stages arrived as their own streamed components
because they are about the *run* rather than the change. The first stage is
about neither and has nothing a founder acts on.

## What has not been proved

**Nothing here has been dogfooded.** Third sprint running. Every screen in this
record was opened against a fixture, in a browser, at two widths — and not one
of them has been seen with a real project, a real run, a real change and a real
merge behind it. The two live gaps this sprint found had both been shipped for
weeks with green suites over them, which is precisely the failure mode
[rule 69](../../CLAUDE.md)'s fourth question exists to catch, and it is still
open.

**The composed thread has never been watched advancing.** The block reads
`change.progress.stage` on each render, so a change moving from preview to
decision should redraw as a different screen. That is reasoned about from the
derivation and asserted per-stage from fixtures; nobody has watched one change
walk through it.

**The history has never been rendered from the database.** `listChangeHistory`
is unit-tested through its projection and browser-tested through a fixture. The
four-read claim is a property of the code, not a measurement — no query count
was taken against a project with a month of changes in it.

## The count, and what it means

Nine defects, and every one was found by rendering a page or pressing a button.
Two of them were live in production with green suites over them: the start
sweep, which had clipped the chained offer into a single pill and cut its own
sentence in half since chains shipped; and the code-only preview gate. Three
more were the deleted surface's absences. The rest were the thread saying the
same sentence twice, a control that would have rendered permanently disabled,
and a table whose outcome column sat off the right edge of a phone.

The suite found none of them. It could not: a test asserts what a screen says,
and every one of these was a question about what a screen *is*.

## Validation

- `pnpm lint` — 0 errors, 0 warnings
- `pnpm test --run` — 525 files, 9,342 tests, all passing
- `pnpm build` — clean, typecheck included
- `npx playwright test` — 691 tests, all passing
- No migration; no schema change; no new dependency
