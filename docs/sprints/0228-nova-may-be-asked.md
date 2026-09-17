# Sprint 0228 — Nova may be asked

Slice 6 of [ADR 0109](../decisions/0109-nova-first-application-shell.md): the
conversation lane. A founder can type a question and get an answer grounded in
what Vibe knows — and every consequential effect stays exactly where it was,
behind a control they press.

The price is [ADR 0110](../decisions/0110-a-question-costs-nothing-and-is-bounded.md)'s,
decided without the owner in the room and marked provisional in the one respect
that is theirs to revisit. **Neither migration is deployed, and the lane is off
by default.** See *What has not been proved*.

## What was wrong

**Eighteen action ids cannot express a question.** The catalogue answers *what
to do*. A founder also asks *why is conversion our biggest problem*, *why Move 1
before Move 2*, *how do you read our pricing*, *explain the audit more simply*.
None of those is an action, none can be pressed into an id, and refusing them
is refusing the product an AI business operator is supposed to be.

**And the foreclosure was load-bearing in three places.** The Nova architecture
audit's §M closed *an unrestricted chat input*; `nova-ui.test.ts` asserted *no
chat input anywhere*; `first-run.ts` told the founder *there is nothing to type*.
Every one of those was right about what it refused — **free text feeding a
decision** — and none of them refused a bounded input feeding a validated reply.
Reopening it is a decision, not a feature, and it is made under conditions.

## What changed

**A lane that may reason and holds no capability.**

```
modules/nova/conversation/
  payload.ts   the pack shape, the output shape, the versions, the context hash
  context.ts   pure assembly from view models the caller already read
  prompt.ts    the persona that may explain, and the fence her material arrives behind
  checks.ts    what Vibe refuses to show, whatever the model wrote
  service.ts   the call, and the deterministic floor under every path
  limits.ts    what stands in for a price
  switch.ts    the operational lever, default off
modules/nova/intent/resolve.ts   an instruction → a control, without a model
features/nova/conversation/      the composer, the reads, the one command
```

**The model has no say in what it reads.** `context.ts` is pure: it holds no
database handle, makes no query, and cannot be made to fetch anything by a
sentence in a repository. The reads are composed one layer up from the same
module functions the screens use, so a founder's conversation sees exactly what
their screens see.

**The output is a shape, not a string.** One message, one artifact pointer from
a closed union, one catalogue id — and both ids are validated against the lists
Vibe put in the pack. A pointer that does not resolve is **dropped and the
answer kept**; a sentence that is false **replaces the answer**. That asymmetry
is rule 45's shape applied to a pointer instead of an evidence citation.

**The validator refuses what explanation makes tempting.** The voice tier's
always-banned claims and module vocabulary carry over unchanged, and one rule is
new: a reply may never say Vibe already did something. The founder asks whether
to re-run the audit, the model agrees and writes *"I've started it"*, and the
press that would actually start it sits there unpressed while they wait for a
result that is not coming. That is ADR 0109 §5's sentence in code — *generated
text is never the last thing before a consequential effect; a press is* — and it
is refused outright rather than degraded, because there is no version of it that
is true.

**`findUnnegated` is shared rather than copied.** A founder may ask *"is it live
yet?"*, and the correct answer — *"I can't tell you whether it is live; Vibe
never observes that"* — contains the banned phrase and is the sentence this
product exists to say.

**An instruction never waits on a provider.** `resolveNovaIntent` matches a
founder's words against the product's own vocabulary — the labels
`NOVA_ACTION_META` already carries — because those are the words the interface
has been showing them. It is cheap, instant and inspectable, and it refuses
anything it is not sure of, which is the only direction it may be wrong in.

**One atomic write, through a function rather than a client.**
`append_nova_conversation_turn` writes the question, the reply and their
pointers together. It is `security definer` because both alternatives were
worse: widening `nova_messages`' insert policy to admit `author = 'nova'` would
let a browser put words in her mouth in the founder's own history, and the
service-role client is foreclosed for this layer by name (audit §C.8). Ownership
is re-checked inside against `auth.uid()` through the project row.

**Asking costs nothing and is bounded instead.** ADR 0110: a price on a question
is a tax on understanding — the founder least sure the answer is worth 2 Credits
is the one who most needs it, and they guess instead and spend 35 on the wrong
Move. Rule 78 forecloses a retail price anyway, since there are no measured
conversation costs to price against. Two windows stand in for it, per thread and
per account, and a refusal is a sentence that names the remedy.

## The claim that was rewritten in the open

`nova-ui.test.ts` asserted *"has no chat input anywhere"*, and its comment said
*"there is nothing to type at her"*. Editing that green would have been the
cheapest and worst move available — the same trap Sprint 0215 recorded walking
past when it narrowed the same guard for the name field.

It is narrower now and still absolute: **Home has no input at all.** Home is the
ranking — one thing to do and a control for it — and a box on it would be a
second way to ask for the same thing. The composer lives on the thread, and
`conversation-lane.test.ts` holds its own bounds.

`first-run.ts`'s docblock lost the same sentence, in the open, with why. Its
`WORKFLOW_STEPS` did **not** change: *"you don't need to write prompts"* is
still true and is the part that matters on a first meeting. Being able to is a
different sentence, and the introduction is not where it belongs.

## What the suite caught that review had not

**The switch ignored the spend-incident lever.** `isNovaConversationEnabled`
read its own flag and nothing else, while `isNovaVoiceEnabled` — which the lane
is modelled on — reads `PAID_OPERATIONS_DISABLED` too, on the argument that a
switch thrown to stop money leaving must stop paid inference or it is not the
switch it says it is. A conversation reaches a provider on a keystroke, which
makes it the worst one to have missed. Found by reading the file it was copied
from; fixed, with its own test for the exact-`"1"` rule.

**`append_nova_conversation_turn` is the first `SECURITY DEFINER` function in
this schema that `authenticated` may execute**, and `lifecycle-authority.migration.ts`
said so before any human did. Its assertion read *"No exceptions … the honest
form of this assertion: none"*, and it now names one with the argument written
beside it: the reach is bounded by ownership rather than by an argument, it
refuses a caller with no session, and the one thing it does leave open — a
founder writing a sentence into their own transcript attributed to Nova — is
self-deception rather than access, because the transcript is never read back as
authority. The alternative, widening the insert policy, allows the same thing
with no atomicity and no ownership re-check.

## The seven things this lane must never do

Each is an existing rule, restated where a generative path could erode it — and
each erodes the same way, through one reasonable-looking import. So
`conversation-lane.test.ts` is seven assertions rather than a paragraph: no
service-role client, no fetch or browser or sandbox, no credential, no merge or
approval or branch write, no operation started, generation in exactly one
`"use server"` command, and no reasoning requested or read. Two were
mutation-tested by planting the real thing.

## What was decided against

- **`features/nova/actions/`**, which the audit named. A proposal is a catalogue
  id and the control it renders is the one `bindings/` already binds. A
  directory between them is a second answer to a question that has one.
- **A reuse identity for a turn.** ADR 0086's claim makes the voice tier safe
  because the same payload means the same sentence. The same question asked
  twice is a *second question* — what Vibe knows has usually moved — so there is
  no claim row and no cache, and the context hash records the shape a reply was
  answered from rather than keying anything.
- **A model for intent resolution.** §E.3 said deterministic ships first, and it
  is right for a reason beyond cost: when this resolves, a person can say
  exactly why, which matters most for the sentences that end in a press.
- **A cheaper model.** The voice eval measured Haiku 4.5 at 41% grounded and 39%
  no-invention against Sonnet 5's 72% and 78%, over 46 cases. Haiku invented the
  *reasons* while forbidden to give any; this lane is allowed to give them.
  Choosing the cheaper model for the harder task because the easier task
  measured badly on it is the wrong direction to be wrong in.
- **Thinking tokens.** A founder is watching a composer. The eval deliberately
  gave Sonnet none, and if avoiding invention had needed them that would itself
  have been the finding.

## What has not been proved

- **Neither migration is deployed.** `SUPABASE_ACCESS_TOKEN` is unset in this
  environment, so `pnpm db:status`, `pnpm db:push` and `pnpm db:types` cannot
  run, and rules 29–34 refuse the SQL-editor fallback. Both are proven against a
  PostgreSQL cluster the harness creates itself — thirty-one assertions across
  the two — and the remote database has neither. **Until they are deployed,
  nothing in the product can write a thread or a turn.**
- **No model has ever answered a question here.** Every test uses a double. The
  prompt is written against the voice tier's measured failures and is itself
  **unmeasured**: there is no conversation eval, no `cases.ts`, no rubric and no
  judge run. That is part of why ADR 0110 prices the operation at nothing.
  `NOVA_CONVERSATION_ENABLED` is off by default and should stay off until somebody
  has read a hundred real answers.
- **The composer was seen at rest and never pressed in a browser.** Pressing
  reaches a Server Action that begins with `requireProjectAccess`, and the
  browser suite has no session. What a browser proved is what is true before
  anything is sent: the field is legible, bounded, keyboard-reachable, and says
  what asking costs.
- **The bound has never been reached.** The numbers are round rather than
  measured, which is how they are described in the code.
- **Node 22 ran the suite; the engine field says 24.**

## Validation

- `pnpm lint` — clean.
- `pnpm typecheck` — clean.
- `pnpm test` — 9,748 tests, all passing (9,660 before).
- `pnpm db:test` — 469 passing across 31 files, including 10 new assertions
  about the turn function and one widened `SECURITY DEFINER` review.
- `pnpm test:e2e` — 886 passing (881 before; five new).
- Mutation-tested: two of the lane's seven conditions, and the resolver's
  refusal to guess between two controls sharing a label.
- Looked at in a browser at 390 and 1280.
