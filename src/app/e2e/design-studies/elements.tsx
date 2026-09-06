import type { CSSProperties, ReactNode } from "react";
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

/* ── The Bubble ───────────────────────────────────────────────────────── */

/**
 * What Nova says, and the container everything else sits in.
 *
 * ## Why this replaced the Line's registers
 *
 * The first attempt put the register *inside* the sentence: a coloured rule at
 * the text's left edge, four ways. It was rejected on sight, and the reason it
 * deserved to be is that a rule beside a paragraph is a document grammar —
 * a pull quote, a blockquote, a changebar. This surface is not a document. It
 * is somebody speaking, and the wireframe says so: every line of text sits in
 * a bubble that arrives.
 *
 * A bubble already carries its own nature, so the register belongs to it. That
 * is the whole move, and it is why `Line` and `Context` below are now plain
 * text with no markers of their own.
 *
 * ## The four registers, and what makes them tell apart without hue
 *
 * `DESIGN.md` says colour is never the only signal, and the ten blocked
 * moments are the case that punishes a design that forgets it. A register here
 * is four properties and only the last is hue:
 *
 * - **Fill.** An aside has none and no contour either — it is a bubble with no
 *   walls, which is the one register a greyscale screenshot cannot confuse. A
 *   concern is the only tinted one. The other two share a fill, because a
 *   difference small enough to mean *thinner* is too small to see and one
 *   large enough to see stops a bubble reading as raised at all.
 * - **Contour weight.** None, hairline, or double. The one register asking to
 *   be looked at first is the only one drawn at 2px.
 * - **Contour style.** Solid means Vibe observed it. Dashed means it inferred
 *   it from a clock — `focus.ts`'s own distinction, which until now reached
 *   the screen only as amber-instead-of-coral: a claim about severity where
 *   the domain was making one about certainty.
 * - **Hue**, last.
 *
 * The greyscale row in `study-bubble` is what holds this honest. If the four
 * collapse there, the design was colour and nothing else.
 *
 * ## Geometry
 *
 * A bubble hugs its content up to a reading measure, the way every chat a
 * founder has ever used does — a three-word remark should not be a banner. The
 * exception is a bubble carrying a Move: a decision takes the full measure,
 * because the Move's own rule is that its geometry never depends on its state,
 * and a control that changed width with the length of the sentence above it
 * would break that from the outside.
 */
export type BubbleRegister = "statement" | "concern" | "guess" | "quiet";

const BUBBLE: Record<BubbleRegister, { klass: string; tint: string; tail: boolean }> = {
  statement: { klass: "bubble-statement", tint: "text-fg-meta", tail: true },
  concern: { klass: "bubble-concern", tint: "text-coral", tail: true },
  guess: { klass: "bubble-guess", tint: "text-amber", tail: true },
  /* An aside is a note, not an utterance. Nothing points at a speaker. */
  quiet: { klass: "bubble-quiet", tint: "text-fg-meta", tail: false },
};

export function Bubble({
  children,
  register = "statement",
  /** The status word, from `statusForFocusTier`. Never written at a call site. */
  eyebrow,
  /**
   * Whether this one points at the speaker. Only the first of a run does, the
   * way a phone does it — a tail on every bubble in a group reads as four
   * people talking at once.
   */
  tail = true,
  /** Full measure rather than hugging. True whenever a Move is inside. */
  wide = false,
  /** Stagger position, so a thread arrives in order rather than at once. */
  index = 0,
}: {
  children: ReactNode;
  register?: BubbleRegister;
  eyebrow?: string;
  tail?: boolean;
  wide?: boolean;
  index?: number;
}) {
  const spec = BUBBLE[register];
  const hasTail = tail && spec.tail;

  return (
    <div
      className={`bubble bubble-arrive ${spec.klass} ${hasTail ? "bubble-tailed" : ""} ${
        wide ? "w-full" : "w-fit max-w-[46ch]"
      } ${register === "quiet" ? "px-1 py-1" : "px-4 py-3.5"} flex min-w-0 flex-col gap-2`}
      style={{ "--i": index } as CSSProperties}
    >
      {hasTail && <BubbleTail />}
      {eyebrow && (
        <p className={`text-label font-mono tracking-[0.16em] uppercase ${spec.tint}`}>{eyebrow}</p>
      )}
      {children}
    </div>
  );
}

/**
 * The tail, drawn rather than faked.
 *
 * Two paths, and the order matters. The **fill** overlaps the body by two
 * pixels, which is what hides the body's own left border across the joint —
 * and it only hides it because the register fills are opaque. The **stroke**
 * then runs the two edges that are genuinely outside: the top, collinear with
 * the bubble's top border, and the diagonal, which stops exactly at the
 * bubble's left edge so the bubble's own border continues the line downward.
 * The third edge is interior and must never be drawn.
 *
 * Both read the register's custom properties, so a dashed bubble gets a dashed
 * tail and a 2px bubble a 2px one, without either side knowing about the other.
 */
function BubbleTail() {
  return (
    <svg
      aria-hidden
      className="bubble-tail"
      width="11"
      height="12"
      viewBox="0 0 11 12"
      fill="none"
    >
      <path d="M11 0.5 L0 0.5 L11 12 Z" fill="var(--bubble-fill)" />
      <path
        d="M11 0.5 L0 0.5 L9.5 10.4"
        stroke="var(--bubble-line)"
        strokeWidth="var(--bubble-width)"
        strokeDasharray="var(--bubble-dash)"
        strokeLinecap="butt"
      />
    </svg>
  );
}

/* ── The Line and the Context ─────────────────────────────────────────── */

/**
 * What Nova says. One sentence, at reading weight rather than display weight.
 *
 * Deliberately unadorned. It carried the register until the bubble took it
 * over, and everything it used to draw — an eyebrow, a rule, a tint — now
 * belongs to the container. A sentence that has to mark itself is a sentence
 * in the wrong box.
 */
export function Line({ children }: { children: ReactNode }) {
  return <p className="text-title font-semibold text-balance text-fg">{children}</p>;
}

/** The explanation under a Line. Quieter, and never a box of its own. */
export function Context({ children }: { children: ReactNode }) {
  return <p className="study-measure text-caption text-fg-secondary">{children}</p>;
}
