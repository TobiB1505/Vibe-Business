import type { ReactNode } from "react";
import { statusForFocusTier } from "@/components/system/status-vocabulary";
import {
  deriveNovaFocus,
  type FocusCandidateKind,
  type NovaFocusFacts,
} from "@/modules/nova/focus";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { Context, Line, type LineRegister } from "./elements";
import type { Study } from "./studies";

/**
 * The Line, in its four registers (S0, element track).
 *
 * ## The question this sheet has to answer, not assert
 *
 * Twenty-one moments are meant to be one element with a different word beside
 * them. That thesis stands or falls on whether a founder can tell a blocked
 * moment from a stalled one, and a stalled one from a settled one, *without
 * reading the sentence* — because scanning is what people do before reading.
 *
 * A sheet that showed four tinted eyebrows side by side would look convincing
 * and prove nothing. So this one is built to fail if the design is weak:
 *
 * - **The greyscale row** removes hue entirely. If the registers collapse
 *   there, they were colour and nothing else, and `DESIGN.md`'s rule that
 *   colour is never the only signal was being broken quietly.
 * - **The same-sentence row** puts one sentence into two registers. Any
 *   distinction visible there belongs to the element rather than to the words
 *   it happens to be carrying.
 *
 * ## What the registers are
 *
 * `statement` is the neutral default and carries no edge — nothing is being
 * claimed about status. The other three each make one, so each carries a rule
 * at the sentence's left, and whether that rule is **solid or dashed** says
 * whether Vibe observed the thing or inferred it. That is `focus.ts`'s own
 * distinction, which until now reached the screen only as amber-instead-of-
 * coral: a claim about severity where the domain was making one about
 * certainty.
 *
 * ## Every sentence here is the product's
 *
 * The eyebrow words come from `statusForFocusTier` and the sentences from
 * `deriveNovaFocus` over facts that raise one candidate. A sheet that invented
 * copy would be testing the copy rather than the element.
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
      {
        preparedChangeId: "c",
        stage: "review_required",
        headline: "Two files changed on a branch",
      },
    ],
  },
  audit_failed: { ...BASE, failedOperations: { agent: false, scan: false, audit: true } },
  audit_stalled: { ...BASE, stalledOperations: { agent: false, scan: false, audit: true } },
  nothing_to_do: BASE,
};

function moment(kind: FocusCandidateKind) {
  const entry = buildNovaHomeView(deriveNovaFocus(FACTS[kind] ?? BASE)).primary;
  return { entry, status: statusForFocusTier(entry.tier) };
}

const REGISTERS: {
  register: LineRegister;
  kind: FocusCandidateKind;
  what: string;
  context: string;
}[] = [
  {
    register: "statement",
    kind: "review_change",
    what: "A fact, with nothing wrong in it. No edge — nothing is being claimed about status.",
    context:
      "Vibe finished a change and put it on a branch of its own. Nothing has touched your default branch.",
  },
  {
    register: "concern",
    kind: "audit_failed",
    what: "Observed and wrong. A solid rule, because Vibe watched it happen.",
    context: "The run stopped before it produced a reading. Nothing was charged for the attempt.",
  },
  {
    register: "guess",
    kind: "audit_stalled",
    what: "Inferred from a clock. A dashed rule, because the observation is incomplete.",
    context:
      "Vibe has not seen this fail. It has been going far longer than the work takes, so it is presumed lost — and it may yet finish.",
  },
  {
    register: "quiet",
    kind: "nothing_to_do",
    what: "Nothing needed. An edge, because 'nothing' is still a claim — the quietest one.",
    context:
      "There is nothing waiting on you, and Vibe is not inventing something to fill the slot.",
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

export function StudyLine({ study }: { study: Study }) {
  const panel =
    study.skin === "glass"
      ? "study-glass rounded-panel"
      : "rounded-panel border border-line-2 bg-surface-1";

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-6 py-10 max-sm:px-4 max-sm:py-8">
      <div className="flex flex-col gap-3 rounded-panel border border-dashed border-line-3 bg-well p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <Eyebrow>Element</Eyebrow>
          <p className="text-title font-semibold text-fg">The Line, four registers</p>
        </div>
        <Context>
          Twenty-one moments are meant to be one element with a different word beside them. That
          holds only if a founder can tell them apart before reading the sentence — so this sheet is
          built to fail if the design is weak, rather than to look convincing.
        </Context>
        <Context>
          Solid rule means Vibe observed it. Dashed means it inferred it from a clock. That is
          focus.ts&rsquo;s own distinction, which until now reached the screen only as
          amber-instead-of-coral — a claim about severity where the domain was making one about
          certainty.
        </Context>
      </div>

      {/* ── The four ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The registers</Eyebrow>
        <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
          {REGISTERS.map(({ register, kind, what, context }) => {
            const { entry, status } = moment(kind);
            return (
              <div key={register} className="flex flex-col gap-3 p-6">
                <Line register={register} eyebrow={status.word}>
                  {entry.message}
                </Line>
                <div className="pl-4">
                  <Context>{context}</Context>
                </div>
                <p className="pl-4 font-mono text-caption text-fg-meta">
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
          The test that matters. If the registers collapse here they were colour and nothing else,
          and a founder who cannot see hue — or who is scanning fast — gets four identical
          statements about four different situations.
        </Context>
        <div className={`flex flex-col divide-y divide-line-1 grayscale ${panel}`}>
          {REGISTERS.map(({ register, kind }) => {
            const { entry, status } = moment(kind);
            return (
              <div key={register} className="p-6">
                <Line register={register} eyebrow={status.word}>
                  {entry.message}
                </Line>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── One sentence, two registers ──────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>One sentence, two registers</Eyebrow>
        <Context>
          The words held constant, so any distinction visible belongs to the element rather than to
          what it happens to be carrying. This is the pair the product actually confuses: a run that
          failed, and a run that might still be alive.
        </Context>
        <div className={`grid gap-6 p-6 sm:grid-cols-2 ${panel}`}>
          <Line register="concern" eyebrow="Blocked">
            My audit did not finish.
          </Line>
          <Line register="guess" eyebrow="Blocked">
            My audit did not finish.
          </Line>
        </div>
      </section>
    </div>
  );
}
