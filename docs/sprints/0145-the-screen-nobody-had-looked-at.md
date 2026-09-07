# Sprint 0145 — The screen nobody had looked at

Nova Home renders the ranking, as a conversation. Two ADRs
([0096](../decisions/0096-the-second-design-system-arrives-scoped.md),
[0097](../decisions/0097-design-rules-are-revisable-truth-rules-are-not.md)).

## What was wrong

The ranking that decides what a founder sees first — `deriveNovaFocus`, its
twenty-one candidates, the sentence table, the bound controls — had existed,
tested, since the Nova slice, and had **no production caller**. Home rendered
the business diagnosis instead: a health score, a product identity card, a
stack of secondary tiles. That answers *how is the business doing* to somebody
who came back to ask *what do I do now*.

Ten of the twenty-one moments carried a control that left the conversation.
*Answer in the Agent* sent a founder to another screen to answer a question
Home had just asked — while the run that asked it sat paused — and expected
them to come back.

## What changed, and why that shape

**The card became a thread.** Three object kinds, none nested inside another: a
bubble (Nova speaking, round, tailed), a render block (something she made,
square, panel geometry), and a Move (a control). The register lives on the
bubble — tone and dashed contour, both from `statusForCandidate`, so a bubble
cannot describe a moment differently from the word above it. No sentence was
rewritten and no ranking re-decided: `buildNovaHomeView` projects what
`focus.ts` chose.

**The blocks compose the shipped product rather than reproducing it.** The
Product Scan block *is* `ProductScanExperience` with `variant="block"`; the
gate block *is* `ChangeGates`; the answer block *is* `FounderInputCard`. Each
variant drops that component's own frame and nothing else, because the render
block already is a panel. Changing the source screen changes the thread.

**Two registries decide which block, and both are total.** `BLOCK_FOR_MOMENT`
over `FocusCandidateKind`, `BLOCK_FOR_OPERATION` over `OperationType` — so a
new moment or a new operation type fails the build until somebody decides what
a founder sees, and `none` is a recorded decision rather than a gap.

**Five controls that sent a founder away now resolve in place**: the runtime
question, the planner question, the change's gates, the workspace choice, and
the Move. `execution_offered` stayed a link, because the Agent forecasts two
prices side by side and offering one of them here would be half a decision at a
price whose alternative was never shown.

**The Move is the one control shape.** Variant B from `study-move`, chosen
against all four states the product produces: dark surface, one lit edge, mint
as line and label, and the price *inside* the control rather than beside it.
`ActionBlock` keeps the consequence disclosure and is no longer given a price —
a cost that is a child of the control cannot come apart from what it prices.

## What the lab was for, and what it cost when it drifted

Every component here was designed in `/e2e/design-studies` and then moved into
`src/components/nova/`, with the studies importing it. That is the mechanism,
and it fails silently: the study and the shipped screen were meant to be one
choreography and were three divergences apart — a hand-written header with a
hardcoded "Online", every sentence in its own bubble, no staged arrival — for
as long as nobody put them on the same page.

So two fixture scenarios now mount **production** components:
`study-opening-shipped` draws `NovaOpeningScreen` in replay, and the moments
gallery mounts `NovaFocusThread` instead of the hand-built copy of it that had
been there. Both earned their place immediately.

## What looking found that 8,783 green tests did not

Four defects, each surfaced by rendering a page rather than by reading code.

**The mark broke hydration for every reader on reduced motion.**
`NovaPresence` read the preference through Motion's `useReducedMotion`, which
answers from a media query the browser evaluates before React hydrates — so the
server emitted the mark's keyframe `<style>` and the client did not, and React
discarded and rebuilt the subtree. On the landing page, Nova's rail and her
status row. Fixed with `useMotionAllowed`, whose server snapshot is "no motion",
so the two agree by construction. A sweep of thirteen fixture routes found none
elsewhere.

**The dissolving stages stated three rules and kept one.** "Under
`prefers-reduced-motion` the faded lines are not rendered" — the stylesheet set
the container to `opacity: 1` and left the stale stages standing, the exact
history the component argues the product does not keep. "A line goes because it
stopped being true, never on a timer" — `.nova-dissolve` faded the container to
zero over 420ms `both` from mount, so every past stage vanished on a timer and
the emptied box kept its height for the rest of the run. Position replaces the
timer: current bright, one back 0.55, two back 0.28, three back absent, and
only the stage changing can move a line.

**A block label was suppressed on a wrong premise.** `BLOCK_NAMES_ITSELF.agent`
was set true because the file list writes its own title — but "Files touched"
is a section inside a block called "Building", not a second copy of it, and
dropping the frame's label left the record on screen with nothing saying a run
was in progress.

**The ask said one thing three times, inside two frames.** The render block's
amber border around the card's own amber `Surface`, labelled "Needs your
answer", above a pill saying "Needs your decision". The card gives up its frame
in a block now, and carries the one fact the frame does not make — *a run is
stopped* — plus how long it has been waiting.

A fifth was mid-flight rather than shipped: a disabled Move's price stayed
bright because the wrapper is `display: contents` in the row layout and has no
box for an opacity to apply to.

## The read the founder found

`getMoveWithExecution` called `getOpportunityExecutionSummaries` and used one
entry — a reuse lookup per supported opportunity, plus a second read of the
whole opportunity set, on the product's most-visited route, to answer about one
card. Its own docblock argued against exactly that shape and then did it.

The reported magnitude was corrected in both directions: `MAX_OPPORTUNITIES`
caps a set at five, so it was eleven to thirteen queries rather than the
twenty-six an uncapped set would cost — and two of the reads are `cache()`-warm
on Home, which the founder's proposal would have moved rather than removed. The
part not reported was the duplicate: the plural function reads the set again for
itself.

`executionSummaryFor` is that function's per-opportunity body, lifted out. The
plural one maps it over the set, where the fan-out is what the page is for; the
singular one calls it once. Same computation by construction rather than by two
implementations agreeing — which a hand-rolled single-Move path would have been.
Eight queries, constant. `move-read-cost.test.ts` counts them, and was run
against the old code first: 5 reuse lookups where 1 was expected, the set read
twice, and the total growing 11 → 15 as the set grew from one Move to five.

`readNovaHomeReading` closed a smaller one in the same area: the plan and its
three evidence tables were read twice, once to answer *which step could Vibe
build* and once for *where is the founder in the sequence*. The answers still
differ — an absorbed step counts as satisfied for routing only once the change
that absorbed it is merged — so the derivations stayed apart and the reads came
together.

## What was decided against

**Staging Home's arrivals.** `NovaArriving` exists and the opening uses it.
Home does not: nothing there is appended, the whole thread is re-derived on
every load, and staging it would make a founder wait two seconds to read what
they had already read. The CSS entrance stays, delayed by `--i * 70ms`. The
case that would earn staging — a message landing while somebody is looking —
needs the thread to know which part is new, and Home holds no read marker by
decision.

**A running block for `review` and `audit`.** A change operation runs while the
moment leading the thread is about that same change, so the gates are already
drawn; a running audit has produced no reading, and the only one in hand is the
previous audit's, which is the false freshness the scan block refuses when it
passes a null presentation.

**`AgentQuestionPanel` in the thread.** It would have been a fourth heading. It
is untouched and still owns the Agent route, where it is a page-scale object
rather than a heading inside somebody else's frame.

**The read marker.** "While you were away" divided a set that is either empty or
already the present tense at the top of the thread, because nothing in this
product happens without the founder.

## What is not done

**Onboarding still runs the pre-thread Nova UI** — `NovaFeed`, `NovaMessage`,
`NovaChoice`, the generation before the bubble. Rebuilding it with Nova leading
the flow is its own work on its own branch, and is deliberately not in here.

The `FounderInputCard`'s recommendation button is still a filled mint block, the
shape the Move replaced. It is shared with the plan and the Agent routes, so
changing it there is a wider decision than this branch made.

`buildNovaFeed` remains the lab's linear projection with no production caller.
That is now stated in its docblock rather than being implicit — it shares the
sentence table, so it is a second shape, not a second copy of the copy.

## What has not been proved

**Nothing here has been dogfooded.** No signed-in project, in a browser, on
real data. Every screen was verified through fixture scenarios that mount the
production components — which is what caught four of the five defects above —
plus typecheck, lint, the domain suite and a production build. That is not the
same thing, and rule 69's fourth question is open.

Specifically unseen with real data: the agent block's poll merge (server prefix
plus polled tail, duplicates filtered on the last known sequence), the empty
state before the harness writes its first event, and the wait time on a
genuinely paused run.

No migration, no schema change, no new dependency, no widened allowlist.

## Validation

Domain 8,793 · lint 0/0 · typecheck clean · build green · no migration.
Browser suite: see the pull request; the branch was validated on the domain
suite and by rendering fixture routes in Chromium under both motion
preferences.

*(2026-09-07, the same evening: the browser suite finished — **577 passed**,
none failed, flaky or skipped, 4.7 minutes, against the code at
`60ab6497`, which is this branch's head for everything but this document.
The sentence above stands as written: it was accurate when the record was
made and the run had genuinely not returned.)*
