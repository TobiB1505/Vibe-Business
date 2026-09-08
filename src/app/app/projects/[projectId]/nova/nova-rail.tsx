import type { ReactNode } from "react";
import { NovaPresence, type NovaPresenceState } from "@/components/nova/nova-presence";
import { NovaHappened, NovaThinking } from "@/components/nova/nova-thread";
import { MonoLabel } from "@/components/ui/typography";
import { stepDisplayState, stepSequenceStatus } from "@/modules/action-plans/view";
import type { ActionPlanChecklist } from "@/modules/action-plans/service";
import type { ActivityEntry } from "@/modules/audit-log/view";
import type { OnboardingStep, OnboardingStepState } from "@/modules/onboarding/state";
import { formatElapsedShort } from "@/lib/utils/format-datetime";
import type { NovaWorkingEntry } from "@/modules/nova/home-view";

/**
 * The work column: Nova, the sequence, and what already happened.
 *
 * ## Why the screen has two halves at all
 *
 * The thread is the conversation and this is the work. A founder reading what
 * Nova says is being told one thing at a time, in order, and the two questions
 * that do not fit that shape are *what is the whole sequence* and *what has
 * already happened*. Both are lists, both are true regardless of what she is
 * saying right now, and putting either into the thread would make her repeat
 * herself every load.
 *
 * ## What is deliberately not here
 *
 * The balance and the account. The project layout already carries both — a
 * `WalletChip` and an `AccountMenu` in its own footer — and a second copy in
 * the rail would be the same two facts twice on one screen. The wireframe drew
 * them because it drew the screen alone, with no shell around it.
 *
 * A read marker, too. An earlier draft had a "While you were away" line and a
 * stored timestamp per founder to place it; it was removed on the argument
 * that nothing here runs without the founder, so the set it divided is either
 * empty or already the present tense at the top of the thread.
 */
export function NovaRail({
  presence,
  seed,
  working,
  checklist,
  activity,
  setup,
  mark,
  frame = true,
  contents = (node) => node,
}: {
  /** Derived by `novaPresenceState`, never chosen here. */
  presence: NovaPresenceState;
  /** The project, so one product always draws the same mark. */
  seed: string;
  working: NovaWorkingEntry | null;
  checklist: ActionPlanChecklist | null;
  activity: readonly ActivityEntry[];
  /**
   * Setup, as an ordered list, while there is setup left.
   *
   * The onboarding routes pass it and nothing else does — Home has a plan
   * instead, and the two never coexist, because a project still in setup has
   * no Action Plan and a project with one is past setup.
   */
  setup?: readonly OnboardingStep[];
  /**
   * The mark, when the caller owns it.
   *
   * Only the opening passes one, and only because its mark is a single
   * element that travels from the centre of the screen into this column —
   * `layoutId` needs it mounted by the choreography rather than created here.
   * The picture is the same one `presence` draws.
   */
  mark?: ReactNode;
  /**
   * Whether this column draws its own border.
   *
   * False for the beat where the opening is *drawing* it: the frame arrives
   * as a stroke and hands over to this border as it completes, so for those
   * 380ms the box must not already have one. Nothing else passes it.
   */
  frame?: boolean;
  /**
   * Wraps everything under the mark, for a caller running a choreography.
   *
   * The opening's `rail_content` beat brings what has already happened
   * forward out of nothing, a beat after the frame around it is drawn. This
   * is how it does that without owning a second copy of this column — which
   * is what it did until the copy's padding, gap and mark drifted from these
   * ones and the room the opening built stopped being the room it handed
   * over. Everywhere else this is the identity.
   */
  contents?: (node: ReactNode) => ReactNode;
}) {
  /*
   * Read once, here, and passed down. Every row's label is relative to the
   * same instant, so a list rendered across a minute boundary cannot say "2m"
   * above "1m" for two events that happened in that order.
   */
  const now = new Date();

  /* Built as a list so an empty one adds no flex child, and therefore no gap:
     a wrapper around nothing would be 20px of dead column under the mark. */
  const below = [
    setup && setup.length > 0 ? <Setup key="setup" steps={setup} /> : null,
    checklist ? <Plan key="plan" checklist={checklist} /> : null,
    activity.length > 0 ? <Earlier key="earlier" past={activity} now={now} /> : null,
  ].filter(Boolean);

  return (
    <aside
      className={`rounded-panel flex flex-col gap-5 border p-5 ${
        frame ? "border-line-2 bg-surface-1" : "border-transparent"
      }`}
    >
      <div className="flex flex-col items-center gap-4 text-center">
        {mark ?? <NovaPresence state={presence} seed={seed} size="hero" />}
        {/*
          No name and no state word under the mark. "NOVA / Working" was the
          mark's own two facts written out again underneath it in case it did
          not read — and if a mark does not read, the answer is the mark.

          What replaces it is the stage: what she is doing, in a sentence. It is
          `OPERATION_STAGE_LABELS`, the stage the executor actually wrote, never
          a model's account of its own thinking (rule 43).
        */}
        {working && <NovaThinking>{working.stageLabel}</NovaThinking>}
      </div>

      {below.length > 0 && contents(<>{below}</>)}
    </aside>
  );
}

/**
 * The to-do list, in plan order.
 *
 * ## Why this is a sequence and not a list of open things
 *
 * The alternative was the focus candidates — three rows saying what needed
 * attention. That is a set, and a founder reading it cannot tell what has to
 * happen before what. A plan is ordered, and the order is the useful part:
 * *decide who this is for, then write it, then put the price on the home page,
 * then tell your customers.*
 *
 * None of that ordering is invented here. `dependsOn` is the plan's own,
 * `firstActionableOrder` is the entry point the Action Plan page picks, and
 * `stepSequenceStatus` writes "Waiting for step 2: …" — a fact about
 * dependencies rather than a status somebody assigned.
 *
 * ## The three marks, and why none of them is a percentage
 *
 * A filled square is carried out. A ring is the step to work on now. A hollow
 * outline is waiting, and its row says what for. There is no bar and no "2 of
 * 5 complete", because a plan whose steps are a decision, a piece of writing
 * and a phone call has no honest fraction — and `planMetaSummary` already
 * refuses to invent one.
 */
function Plan({ checklist }: { checklist: ActionPlanChecklist }) {
  const completed = new Set(checklist.completedStepOrders);
  const absorbed = new Map(
    Object.entries(checklist.absorbedByStepOrder).map(([order, by]) => [Number(order), by]),
  );

  return (
    <div className="flex flex-col gap-2.5">
      <MonoLabel>To do</MonoLabel>
      <ol className="flex flex-col gap-2">
        {checklist.steps.map((step) => {
          const display = stepDisplayState(
            step,
            checklist.firstActionableOrder,
            completed,
            absorbed,
          );
          const sequence = stepSequenceStatus(step, checklist.steps, display);
          const here = display === "start_here";
          const done = display === "done" || display === "covered";

          return (
            <li key={step.id}>
              <StepRow
                label={step.title}
                state={here ? "here" : done ? "done" : "waiting"}
                /*
                  Only where it says something the title does not. "Ready now"
                  under every waiting row would be noise; "Waiting for step 2"
                  is the sequencing a founder came here to read.
                */
                note={
                  here
                    ? "Working on this"
                    : sequence.state === "waiting" || done
                      ? sequence.label
                      : undefined
                }
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * Setup, in the same column and the same three marks as the plan.
 *
 * ## Why this is not the Action Plan's component
 *
 * Because `ActionPlanChecklist` is a domain object about opportunities — steps
 * with dependencies, absorption, a first actionable order — and setup has none
 * of that. Building a fake one to reuse `Plan` would have put four phases
 * through a shape that means something else, and the first person to read
 * `absorbedByStepOrder: {}` would have had to work out that it was scaffolding.
 *
 * What the two genuinely share is the *row*, and that is shared: `StepRow`.
 * The marks cannot drift, which is the thing worth protecting — a founder
 * crossing from setup into a plan should not have to learn a second alphabet.
 *
 * ## Why there is no sub-label under the current step
 *
 * The status row above already says what is happening, from the same tables.
 * "Reading your product" under a ringed *Understand* would be the one fact on
 * this screen written twice, six inches apart, by two components that can
 * disagree.
 */
function Setup({ steps }: { steps: readonly OnboardingStep[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      <MonoLabel>Setup</MonoLabel>
      <ol className="flex flex-col gap-2">
        {steps.map((step) => (
          <li key={step.id}>
            <StepRow label={step.label} state={step.state} />
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * One step of an ordered list: a mark, a title, and sometimes a reason.
 *
 * A filled square is carried out. A ring is the step to work on now. A hollow
 * outline is waiting. The mark is `aria-hidden` and the state is said in words
 * beside it, because `DESIGN.md` is explicit that colour is never the only
 * signal — and a shape is not one either.
 */
function StepRow({
  label,
  state,
  note,
}: {
  label: string;
  state: OnboardingStepState;
  note?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        aria-hidden
        className={`mt-1 size-2.5 shrink-0 rounded-[3px] border ${
          state === "done"
            ? "border-mint bg-mint"
            : state === "here"
              ? "border-mint bg-mint-tint"
              : "border-line-strong"
        }`}
      />
      <div className="min-w-0 flex-1">
        <p
          className={`text-caption ${
            state === "here"
              ? "text-fg font-semibold"
              : state === "done"
                ? "text-fg-meta"
                : "text-fg-secondary"
          }`}
        >
          {label}
          <span className="sr-only">
            {" — "}
            {state === "here" ? "working on this" : state === "done" ? "done" : "waiting"}
          </span>
        </p>
        {note && <p className="text-fg-meta text-caption">{note}</p>}
      </div>
    </div>
  );
}

/**
 * What has happened, in the column about the work.
 *
 * The only *record* on this screen. Everything else is re-derived on every
 * load and carries no timestamp, because a sentence computed now was never
 * sent at any particular time; these rows are `audit_events`, they say what
 * occurred, and that stays true.
 *
 * One list, newest at the bottom, with no line through it: nothing in this
 * product happens without the founder, so a "while you were away" divider
 * would mark the boundary of a set that is either empty or already said at
 * the top of the thread.
 */
function Earlier({ past, now }: { past: readonly ActivityEntry[]; now: Date }) {
  return (
    <div className="border-line-1 flex flex-col gap-1.5 border-t pt-4">
      <MonoLabel>Earlier</MonoLabel>
      <div className="flex flex-col">
        {past.map((entry) => (
          <NovaHappened
            key={entry.id}
            title={entry.title}
            at={formatElapsedShort(entry.at, now)}
            tone={entry.tone}
            facts={entry.facts}
          />
        ))}
      </div>
    </div>
  );
}
