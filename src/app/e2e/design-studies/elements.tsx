import type { ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";

/**
 * The design system's vocabulary, as elements rather than as screens.
 *
 * ## Why this file exists
 *
 * Because the alternative was found not to scale. `study-blocked` designed ten
 * situations and produced ten tiles; twenty-one moments would have produced
 * twenty-one layouts, each with its own copy of a button. The rhythm the
 * console study established — a line, an explanation, a move — is already the
 * layout for every moment the product has. What changes between them is
 * register and content.
 *
 * So the work is to define each word once, here, and let the studies pour
 * content into it. A study that hand-rolls its own control is a study whose
 * findings do not transfer.
 *
 * This is lab code: it lives under `design-studies/`, is reachable only
 * through the fixture route, and nothing in `/app` imports it. What earns its
 * place here graduates to `src/components/` later, deliberately.
 */

/* ── The Move ─────────────────────────────────────────────────────────── */

/**
 * The one action a moment offers, with its cost inside it.
 *
 * ## Which design this is, and why
 *
 * Variant **B** from `study-move`, chosen at review: a dark surface with one
 * lit edge, mint as line and label only. The three were compared in all four
 * states, and B is the one whose resting state carries no area of accent —
 * emphasis comes from luminance, which is the chosen direction's own sentence
 * rather than a preference. The filled mint block every earlier study used
 * belongs to a direction that was not chosen.
 *
 * ## The cost is inside, not beside
 *
 * A price rendered next to a control is two objects for one commitment, and
 * the blocked study proved the failure mode: its separate chip printed "Trying
 * again costs" with nothing after it, because `agent_execution` resolves to a
 * silent display. Here the cost is a child, so it cannot come apart from the
 * thing it prices, and an absent cost simply leaves the row's right side
 * empty rather than leaving a label stranded.
 *
 * ## Geometry does not depend on state
 *
 * The row is full measure in every state. A Move that shrank when its price
 * disappeared would change size as a project changed, which is the reflow the
 * motion obligations exist to prevent — and it would make the priced and free
 * versions of the same decision look like different kinds of thing.
 */
export function Move({
  label,
  operation = null,
  balance,
  /** Where it goes, when pressing leaves the product. Said before the click. */
  leavesTo,
  className,
}: {
  label: string;
  /** The retail kind this charges under. Null when free or unpriced. */
  operation?: RetailOperationKind | null;
  balance?: CostBalance | null;
  leavesTo?: string;
  className?: string;
}) {
  return (
    <span
      className={`move-lit relative flex w-full items-center justify-between gap-4 overflow-hidden rounded-nav border border-line-3 bg-surface-2 px-4 py-3 ${className ?? ""}`}
    >
      {/*
        The control's only light. A hairline at partial width at rest, reaching
        the full edge on hover — nothing moves position, so there is no reflow
        and nothing to reserve.
      */}
      <span
        aria-hidden
        className="move-lit-band pointer-events-none absolute inset-x-0 top-0 h-px"
      />
      <span className="text-ui font-semibold text-mint">{label}</span>
      {leavesTo ? (
        <span className="shrink-0 text-caption text-fg-meta">{leavesTo}</span>
      ) : (
        <CostDisclosure operation={operation} balance={balance} />
      )}
    </span>
  );
}

/**
 * Whether a Move will actually show a cost, asked the way the component asks
 * it.
 *
 * Exported because callers sometimes need to know *before* laying out — a
 * heading that says "this costs" is a dangling label when the answer is no.
 * `priceDisplayFor` is the same function `CostDisclosure` consults, so the two
 * can never disagree.
 */
export function moveShowsCost(operation: RetailOperationKind | null): boolean {
  if (operation === null) return false;
  return priceDisplayFor(operation).kind !== "silent";
}

/* ── The Line and the Context ─────────────────────────────────────────── */

/**
 * What Nova says. One sentence, at reading weight rather than display weight.
 *
 * ## Why the register is not a colour
 *
 * The obvious version of this element tints an eyebrow four ways and calls the
 * moments distinguished. It is not enough, and the greyscale row in
 * `study-line` is the proof: with hue removed, four tinted eyebrows are one
 * eyebrow. `DESIGN.md` says colour is never the only signal, and the ten
 * blocked moments are the case that punishes it — a founder scanning a screen
 * needs to know *what kind of stop this is* before they read a word.
 *
 * So a register carries three things, and only the first is hue:
 *
 * - **A word.** From `statusForFocusTier`, so the vocabulary is the product's.
 *   A screen reader gets exactly what an eye gets.
 * - **An edge, or none.** `statement` is the neutral default and carries no
 *   marker; the three registers that make a claim about status carry a rule at
 *   the sentence's left. Emphasis is spent only where a claim is being made.
 * - **Whether that edge is solid or dashed**, which is the semantic one below.
 *
 * ## Solid means observed; dashed means inferred
 *
 * `focus.ts` separates the two and says why: *a failure is something Vibe
 * observed, and a stall is something it inferred from a clock.* Until now that
 * distinction reached the screen as amber-instead-of-coral, which reads as
 * *less bad* rather than as *less certain* — a different claim entirely.
 *
 * A dashed rule is the drawn form of an incomplete observation. It is the one
 * property here doing semantic work rather than decorative, which is why it is
 * a rule of the element rather than a choice a call site makes.
 */
export type LineRegister = "statement" | "concern" | "guess" | "quiet";

const REGISTER: Record<LineRegister, { tint: string; edge: string | null; dashed: boolean }> = {
  /* The neutral default. No edge: nothing is being claimed about status. */
  statement: { tint: "text-mint", edge: null, dashed: false },
  /* Observed and wrong. */
  concern: { tint: "text-coral", edge: "border-coral", dashed: false },
  /* Inferred from a clock. Dashed, because the observation is incomplete. */
  guess: { tint: "text-amber", edge: "border-amber", dashed: true },
  /* Nothing needed. An edge, because "nothing" is still a claim — and the
     quietest one, so it is drawn at the foreground ramp's own colour. */
  quiet: { tint: "text-fg-meta", edge: "border-line-3", dashed: false },
};

export function Line({
  children,
  register = "statement",
  eyebrow,
}: {
  children: ReactNode;
  register?: LineRegister;
  /** The status word. From the product's vocabulary, never written here. */
  eyebrow?: string;
}) {
  const { tint, edge, dashed } = REGISTER[register];

  return (
    <div
      className={
        edge
          ? `flex flex-col gap-2 border-l-2 pl-4 ${edge} ${dashed ? "border-dashed" : "border-solid"}`
          : "flex flex-col gap-2"
      }
    >
      {eyebrow && (
        <p className={`text-label font-mono tracking-[0.16em] uppercase ${tint}`}>{eyebrow}</p>
      )}
      {/*
        The sentence stays at the foreground ramp in every register. Nothing a
        founder has to read is rendered in an accent — the register is carried
        by the eyebrow and the edge, which are furniture.
      */}
      <p className="study-measure text-title font-semibold text-balance text-fg">{children}</p>
    </div>
  );
}

/** The explanation under a Line. Narrower, quieter, and never a box. */
export function Context({ children }: { children: ReactNode }) {
  return <p className="study-measure text-caption text-fg-secondary">{children}</p>;
}
