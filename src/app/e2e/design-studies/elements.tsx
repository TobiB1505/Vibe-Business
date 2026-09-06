import type { CSSProperties, ReactNode } from "react";
import { CostDisclosure } from "@/components/system/cost-disclosure";
import { priceDisplayFor } from "@/components/ui/credit-price";
import type { CostBalance } from "@/components/system/cost-disclosure";
import type { RetailOperationKind } from "@/modules/credits/retail";
import type { StatusTone } from "@/components/ui/status-pill";

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
 * ## The register is two axes, and neither is chosen here
 *
 * Both come from `statusForCandidate`, so a bubble cannot describe a moment
 * differently from the pill beside it:
 *
 * - **`tone`** — what kind of thing this is. Coral wrong, amber your turn,
 *   mint available, neutral a plain fact.
 * - **`open`** — whether a loop is still hanging. Drawn as a dashed contour.
 *
 * The second axis is the fix for a defect the first design had. A stalled run
 * was drawn amber where a failed one was coral, which reads as *less bad* when
 * the domain was saying *less certain* — a different claim entirely. Coral and
 * dashed says both halves: something is wrong, and it is not over.
 *
 * ## What survives with the colour removed
 *
 * `DESIGN.md` says colour is never the only signal. Four appearances survive
 * greyscale — hairline solid, hairline dashed, double solid, double dashed —
 * and they carry the distinctions that matter when somebody is scanning rather
 * than reading: *something is wrong*, *nothing has concluded*, *neither*.
 * Within "nothing is wrong", available and waiting-on-you are separated by hue
 * and by the word, and the sheet says that rather than claiming more.
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
const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bubble-neutral",
  active: "bubble-active",
  success: "bubble-active",
  waiting: "bubble-waiting",
  problem: "bubble-problem",
};

const TONE_TINT: Record<StatusTone, string> = {
  neutral: "text-fg-meta",
  active: "text-mint",
  success: "text-mint",
  waiting: "text-amber",
  problem: "text-coral",
};

export function Bubble({
  children,
  /** What kind of thing this is. From `statusForCandidate(...).tone`. */
  tone = "neutral",
  /** Whether a loop is hanging. From `statusForCandidate(...).open`. */
  open = false,
  /**
   * Something also true, never something to do. A bubble with no walls, and no
   * tail — nobody is being spoken to, so nothing points at a speaker.
   */
  aside = false,
  /** The status word, from `statusForCandidate`. Never written at a call site. */
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
  tone?: StatusTone;
  open?: boolean;
  aside?: boolean;
  eyebrow?: string;
  tail?: boolean;
  wide?: boolean;
  index?: number;
}) {
  const hasTail = tail && !aside;

  return (
    <div
      className={`bubble bubble-arrive ${aside ? "bubble-aside" : TONE_CLASS[tone]} ${
        open && !aside ? "bubble-open" : ""
      } ${hasTail ? "bubble-tailed" : ""} ${wide ? "w-full" : "w-fit max-w-[46ch]"} ${
        aside ? "px-1 py-1" : "px-4 py-3.5"
      } flex min-w-0 flex-col gap-2`}
      style={{ "--i": index } as CSSProperties}
    >
      {hasTail && <BubbleTail />}
      {eyebrow && (
        <p
          className={`text-label font-mono tracking-[0.16em] uppercase ${
            aside ? TONE_TINT.neutral : TONE_TINT[tone]
          }`}
        >
          {eyebrow}
        </p>
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
 * the bubble's top border, and the diagonal, which stops at the bubble's left
 * edge so the bubble's own border continues the line downward. The third edge
 * is interior and must never be drawn.
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
