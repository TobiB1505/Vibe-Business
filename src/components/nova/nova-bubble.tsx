import type { CSSProperties, ReactNode } from "react";
import type { StatusTone } from "@/components/ui/status-pill";

/**
 * What Nova says, and the container everything else sits in.
 *
 * ## Where it came from, and why it lives here now
 *
 * The design lab (`src/app/e2e/design-studies/`) is where this shape was
 * argued out, and the lab keeps drawing it — by importing this file. A
 * component the product renders may not live under `e2e/`, and two copies of
 * one bubble is how a lab stops being an answer to anything.
 *
 * Its stylesheet is `globals.css`, beside the other component classes, because
 * the opaque fills below are load-bearing rather than decorative and a bubble
 * without them draws a hairline through its own tail.
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
 * ## A bubble is speech, and only speech
 *
 * Nothing executable goes inside one. A bubble exists to show that Nova is
 * *saying* something; a Move is something the founder can *do*, and putting a
 * button in a speech bubble makes those one object when they are two. The
 * question goes in the bubble and the control sits under it, unwrapped.
 *
 * The first draft had a `wide` prop that existed solely to hold a Move, which
 * is the shape of the mistake showing through the API.
 *
 * ## Geometry
 *
 * A bubble hugs its content up to a reading measure, the way every chat a
 * founder has ever used does — a three-word remark should not be a banner.
 *
 * It may hold more than one paragraph, and `speech.ts` decides when: short
 * lines stay several bubbles, prose becomes one. The gap between children is
 * a paragraph break rather than a list gap, which is why it is larger than the
 * spacing between bubbles — inside one utterance the sentences belong closer
 * to each other than two utterances do, and only the container says so.
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

export function NovaBubble({
  children,
  /** What kind of thing this is. From `statusForCandidate(...).tone`. */
  tone = "neutral",
  /** Whether a loop is hanging. From `statusForCandidate(...).open`. */
  open = false,
  /**
   * Something also true, never something to do.
   *
   * Still a bubble — quieter, and without the moment's register, because four
   * coloured contours down one thread is four claims where the product is
   * making one.
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
  /** Stagger position, so a thread arrives in order rather than at once. */
  index = 0,
}: {
  children: ReactNode;
  tone?: StatusTone;
  open?: boolean;
  aside?: boolean;
  eyebrow?: string;
  tail?: boolean;
  index?: number;
}) {
  const hasTail = tail && !aside;

  return (
    <div
      className={`bubble bubble-arrive ${aside ? "bubble-neutral" : TONE_CLASS[tone]} ${
        open && !aside ? "bubble-open" : ""
      } ${hasTail ? "bubble-tailed" : ""} flex w-fit min-w-0 max-w-[46ch] flex-col gap-2.5 px-3.5 py-2.5`}
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
 *
 * The outer edge is a curve rather than a straight hypotenuse. A triangle is
 * what a wedge looks like; a tail is what a drop of something looks like as it
 * leaves the shape, and the difference is the whole reason the first version
 * read as a spike glued to a card.
 */
function BubbleTail() {
  return (
    <svg aria-hidden className="bubble-tail" width="11" height="12" viewBox="0 0 11 12" fill="none">
      <path d="M11 0.5 L1.5 0.5 Q0 0.6 0.6 2 Q3 6.6 11 12 Z" fill="var(--bubble-fill)" />
      <path
        d="M11 0.5 L1.5 0.5 Q0 0.6 0.6 2 Q3 6.6 9.5 10.4"
        stroke="var(--bubble-line)"
        strokeWidth="var(--bubble-width)"
        strokeDasharray="var(--bubble-dash)"
        strokeLinecap="butt"
      />
    </svg>
  );
}
