import type { ReactNode } from "react";
import { statusForFocusTier } from "@/components/system/status-vocabulary";
import { creditsToUnits } from "@/modules/credits/units";
import {
  deriveNovaFocus,
  type FocusCandidateKind,
  type NovaFocusFacts,
} from "@/modules/nova/focus";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { Bubble, type BubbleRegister, Context, Line, Move } from "./elements";
import type { Study } from "./studies";

/**
 * The Bubble (S0, element track) — the first piece of the wireframe.
 *
 * ## What this sheet is answering
 *
 * The Line study put the register inside the sentence and was rejected. The
 * wireframe says why without arguing: every line of text on that screen sits
 * in a bubble that arrives, and a bubble already carries its own nature. So
 * the register moved outward, and this sheet has to show that it survived the
 * move — that four situations are still four situations when the marker is the
 * container rather than a rule beside the words.
 *
 * ## Built to fail, not to convince
 *
 * - **The greyscale row** removes hue. Three of the four register properties
 *   are meant to survive it — fill weight, contour weight, contour style — and
 *   if they do not, the design was colour with a story attached.
 * - **The thread** runs the wireframe's own sequence on the product's real
 *   projection: a statement, the aside that justifies it, the move it leads
 *   to. Nothing here is copy this file invented; `buildNovaFeed` wrote all of
 *   it, which is the only way the sheet tests the element rather than the
 *   prose.
 * - **The geometry row** puts three words, forty words and a decision in the
 *   same column, because a container that looks right at one length and wrong
 *   at another is not finished.
 */

const BASE: NovaFocusFacts = {
  sourceDisconnected: false,
  failedOperations: { agent: false, scan: false, audit: false },
  stalledOperations: { agent: false, scan: false, audit: false },
  changes: [],
  questions: [],
  moves: [],
  plannedMoveId: null,
  executableStep: null,
  planOffered: false,
  auditOutdated: false,
  repositoryReadOutdated: false,
  workspaceChoiceRequired: false,
  working: null,
};

const FACTS: Partial<Record<FocusCandidateKind, NovaFocusFacts>> = {
  review_change: {
    ...BASE,
    changes: [
      { preparedChangeId: "c", stage: "review_required", headline: "Two files changed on a branch" },
    ],
  },
  audit_failed: { ...BASE, failedOperations: { agent: false, scan: false, audit: true } },
  audit_stalled: { ...BASE, stalledOperations: { agent: false, scan: false, audit: true } },
  nothing_to_do: BASE,
};

function moment(kind: FocusCandidateKind) {
  const entry = buildNovaHomeView(deriveNovaFocus(FACTS[kind] ?? BASE)).primary;
  return { message: entry.message, word: statusForFocusTier(entry.tier).word };
}

const REGISTERS: {
  register: BubbleRegister;
  kind: FocusCandidateKind;
  what: string;
}[] = [
  {
    register: "statement",
    kind: "review_change",
    what: "Nova's ordinary voice. Filled, hairline contour, solid — nothing is being claimed about status beyond the fact itself.",
  },
  {
    register: "concern",
    kind: "audit_failed",
    what: "Observed and wrong. The only 2px contour on the sheet and the only tinted fill: this is the register asking to be looked at first.",
  },
  {
    register: "guess",
    kind: "audit_stalled",
    what: "Inferred from a clock. Dashed, because the observation is incomplete. It is not paler than a statement — a fill difference small enough to mean thinner was too small to see, and one large enough to see stopped the bubble reading as raised.",
  },
  {
    register: "quiet",
    kind: "nothing_to_do",
    what: "An aside: something also true, never something to do. No walls and no tail, because nobody is being spoken to.",
  },
];

/** The credits shown against a Move here. A fixture, like every other value. */
const STUDY_BALANCE = { availableCredits: creditsToUnits(420), display: "420" };

/**
 * The project the thread is about, so the feed has something to say.
 *
 * Three candidates, so the ranking produces a statement and two asides rather
 * than one sentence on its own. The move it leads to is a *navigation*, and
 * `PROMPT_FOR_CANDIDATE` has no entry for one — there is no question to ask
 * before going somewhere. So this thread shows the CTA beat without a prompt
 * and the geometry section below shows it with one; both are shapes the
 * product produces, and an element that only ever met the fuller of the two
 * would meet the other in production.
 */
const THREAD_FACTS: NovaFocusFacts = {
  ...BASE,
  changes: [
    {
      preparedChangeId: "change_bubble",
      stage: "review_required",
      headline: "Two files changed on a branch of their own",
    },
  ],
  moves: [{ id: "move_bubble", rank: 1, title: "Add a pricing page" }],
  auditOutdated: true,
};

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

/**
 * The thread, in the wireframe's sequence.
 *
 * ## Grouping
 *
 * Only the first bubble of a run points at the speaker. A tail on every one
 * reads as several people talking at once, which is the detail a phone gets
 * right and most product chat UIs get wrong. An aside has no tail at all, so
 * it breaks the run and the message after it starts a new one.
 */
function Thread() {
  const entries = buildNovaFeed(deriveNovaFocus(THREAD_FACTS));
  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );

  /*
    Grouping resolved up front rather than inside the map. A tail depends on
    what came before it, and a fold is the honest shape for that — a counter
    mutated during render is the same answer written as a bug.
  */
  const messages = entries.filter(
    (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> =>
      entry.kind === "nova.message",
  );
  const spoken = messages.reduce<{ entry: (typeof messages)[number]; tail: boolean }[]>(
    (rows, entry) => {
      const previous = rows.at(-1);
      /* An aside does not speak, so it never opens or continues a run. */
      const speaking = previous ? previous.entry.emphasis !== "aside" : false;
      return [...rows, { entry, tail: !speaking }];
    },
    [],
  );
  const lastSpoke = spoken.at(-1)?.entry.emphasis !== "aside" && spoken.length > 0;

  return (
    <div className="flex flex-col gap-2.5">
      {spoken.map(({ entry, tail }, position) => {
        const aside = entry.emphasis === "aside";
        return (
          <Bubble
            key={entry.id}
            register={aside ? "quiet" : "statement"}
            tail={tail}
            index={position}
          >
            {aside ? <Context>{entry.text}</Context> : <Line>{entry.text}</Line>}
          </Bubble>
        );
      })}

      {choice && (
        /*
          The CTA beat. A bubble carrying a Move takes the full measure — the
          Move's own rule is that its geometry never depends on its state, and
          a container that hugged would break that from the outside.
        */
        <Bubble register="statement" tail={!lastSpoke} wide index={spoken.length}>
          {/* Never an empty line above a control: not every candidate asks a
              question, and a blank one reads as a sentence that failed to
              load. */}
          {choice.prompt && <Context>{choice.prompt}</Context>}
          <div className="flex flex-col gap-2.5">
            {choice.options.map((option) => (
              <Move
                key={option.actionId}
                label={option.label}
                operation={option.price}
                balance={STUDY_BALANCE}
              />
            ))}
          </div>
        </Bubble>
      )}
    </div>
  );
}

export function StudyBubble({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Eyebrow>Element</Eyebrow>
          <p className="text-title font-semibold text-fg">The Bubble, four registers</p>
        </div>
        <Context>
          The wireframe&rsquo;s first piece. The Line put the register inside the sentence and it
          was wrong: a rule beside a paragraph is a document grammar, and this surface is somebody
          speaking. The register belongs to the container, so the sentence can go back to being a
          sentence.
        </Context>
        <Context>
          A register is four properties and hue is the last of them — fill weight, contour weight,
          contour style, then colour. Solid means Vibe observed it; dashed means it inferred it
          from a clock, which is focus.ts&rsquo;s own distinction and had never reached the screen
          as anything but a different shade of warning.
        </Context>
      </div>

      {/* ── The four ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The registers</Eyebrow>
        <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
          {REGISTERS.map(({ register, kind, what }, position) => {
            const { message, word } = moment(kind);
            return (
              <div key={register} className="flex flex-col gap-3 p-6">
                <Bubble register={register} eyebrow={word} index={position}>
                  <Line>{message}</Line>
                </Bubble>
                <p className="study-measure font-mono text-caption text-fg-meta">
                  {register} — {what}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Without colour ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The same four, with hue removed</Eyebrow>
        <Context>
          The test that matters. Fill weight, contour weight and contour style are meant to carry
          the distinction on their own; hue is the fourth signal, not the only one. A founder who
          cannot see it — or who is scanning before reading — should still get four situations
          here rather than one.
        </Context>
        <div className={`flex flex-col gap-4 p-6 grayscale ${panel}`}>
          {REGISTERS.map(({ register, kind }, position) => {
            const { message, word } = moment(kind);
            return (
              <Bubble key={register} register={register} eyebrow={word} index={position}>
                <Line>{message}</Line>
              </Bubble>
            );
          })}
        </div>
      </section>

      {/* ── The sequence ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The wireframe&rsquo;s sequence</Eyebrow>
        <Context>
          Statement, the asides that qualify it, then the move it leads to. Every sentence comes
          from buildNovaFeed over one set of facts — a sheet that wrote its own copy would be
          testing the copy. Only the first bubble of a run points at the speaker; an aside has no
          tail at all, so the bubble after it starts a new run. This move is a navigation, so
          nothing is asked before it; the section below shows the priced case, which is.
        </Context>
        <div className={`p-6 max-sm:p-4 ${panel}`}>
          <Thread />
        </div>
      </section>

      {/* ── Geometry ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Three words, forty words, and a decision</Eyebrow>
        <Context>
          A bubble hugs its content up to a reading measure, the way every chat a founder has used
          does — a three-word remark is not a banner. The exception is a bubble carrying a Move:
          that one takes the full measure, because the control&rsquo;s own rule is that its geometry
          never depends on its state.
        </Context>
        <div className={`flex flex-col gap-3 p-6 ${panel}`}>
          <Bubble index={0}>
            <Line>Nothing needs you.</Line>
          </Bubble>
          <Bubble tail={false} index={1}>
            <Context>
              I read the repository at the commit your default branch points at, looked at what the
              site says about the product, and compared the two. The gap between them is where the
              next few moves are, and none of what follows was written by guessing at either half.
            </Context>
          </Bubble>
          <Bubble tail={false} wide index={2}>
            <Context>Re-run the audit against what changed?</Context>
            <Move label="Run the audit" operation="business_audit" balance={STUDY_BALANCE} />
          </Bubble>
        </div>
      </section>
    </div>
  );
}
