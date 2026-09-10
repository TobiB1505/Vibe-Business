import type { ReactNode } from "react";
import { statusForCandidate } from "@/components/system/status-vocabulary";
import { deriveNovaFocus, type FocusCandidateKind, type NovaFocusFacts } from "@/modules/nova/focus";
import { buildNovaFeed, type NovaEntry } from "@/modules/nova/feed";
import { buildNovaHomeView } from "@/modules/nova/home-view";
import { Bubble, Context, Line, Move } from "./elements";
import { MOMENT_FACTS, NO_FACTS } from "./moment-fixtures";
import { speechBubbles } from "@/components/nova/nova-speech";
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
 * move.
 *
 * ## The register is the domain's, not this file's
 *
 * Every bubble here takes its tone, its word and its contour from
 * `statusForCandidate`, which is also what the pill on the real Focus Card
 * reads. A sheet that picked its own four registers would be designing a
 * vocabulary the product does not have — which is what the first draft did,
 * and it is why a stalled run and a crashed one looked like the same thing
 * with a different shade.
 *
 * ## Built to fail, not to convince
 *
 * - **The greyscale row** removes hue. Four appearances are meant to survive
 *   it — hairline solid, hairline dashed, double solid, double dashed — and
 *   they carry the distinctions somebody scanning needs before they read.
 * - **The thread** runs the wireframe's own sequence on the product's real
 *   projection. Nothing here is copy this file invented.
 * - **The geometry row** puts three words, forty words and a decision in the
 *   same column, because a container that looks right at one length and wrong
 *   at another is not finished.
 */

function moment(kind: FocusCandidateKind) {
  const entry = buildNovaHomeView(deriveNovaFocus(MOMENT_FACTS[kind])).primary;
  return { message: entry.message, status: statusForCandidate(entry.kind) };
}

/**
 * One row per appearance the twenty-one moments actually use.
 *
 * Not four registers somebody chose: the two axes are `tone` and `open`, six
 * cells exist and these are the ones the domain fills. Each is shown with a
 * real candidate, so the row is falsifiable — change `CANDIDATE_STATUS` and
 * this sheet changes with it.
 */
const APPEARANCES: { kind: FocusCandidateKind; what: string }[] = [
  {
    kind: "audit_failed",
    what: "Coral, solid, double contour. Vibe watched the run stop, and that is settled — whatever else is true, this part is over.",
  },
  {
    kind: "audit_stalled",
    what: "Coral, dashed. The same weight, because something is equally wrong; dashed, because nothing has concluded and the run may yet be alive. This used to be drawn amber-instead-of-coral, which reads as less bad where the domain was saying less certain.",
  },
  {
    kind: "founder_input_required",
    what: "Amber, dashed. A live run suspended on a person — the loop is hanging, and the dash is what says so.",
  },
  {
    kind: "review_change",
    what: "Amber, solid. Also the founder's turn, and not the same thing: a finished change sitting on a branch, which will still be there in an hour whether anybody looks at it or not.",
  },
  {
    kind: "next_move_available",
    what: "Mint, solid. Nothing is wrong and nothing is hanging; there is something worth starting.",
  },
  {
    kind: "outcome_pending",
    what: "Neutral, dashed. Nothing is wrong either, but the branch moved and no outcome has been read back — open without being a problem.",
  },
];

/**
 * Two runs either side of the line, so the rule can be seen rather than read.
 *
 * The short run is the product's — three real candidate sentences that arrive
 * together. The long run is lab copy and is labelled as such: the feed has no
 * message long enough to cross the threshold today, and a sheet that padded a
 * product sentence to make its point would be testing the padding.
 */
const SPEECH_RUNS: { label: string; texts: string[] }[] = [
  {
    label: "remarks — three bubbles",
    texts: [
      "There is a change waiting for you to look at.",
      "This plan has nothing left in it that I can act on.",
      "My last audit did not finish.",
    ],
  },
  {
    label: "prose (lab copy) — one bubble, three paragraphs",
    texts: [
      "I read the repository at the commit your default branch points at, and looked at what the site says about the product.",
      "The gap between the two is where the next few moves are. None of what follows was written by guessing at either half.",
      "Where I could not read something, I have said so rather than filling it in.",
    ],
  },
];

function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-label font-mono tracking-[0.16em] text-fg-meta uppercase">{children}</p>
  );
}

/** One bubble, rendered from a candidate rather than from arguments. */
function Moment({ kind, index }: { kind: FocusCandidateKind; index: number }) {
  const { message, status } = moment(kind);
  return (
    <Bubble tone={status.tone} open={status.open} eyebrow={status.word} index={index}>
      <Line>{message}</Line>
    </Bubble>
  );
}

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
  ...NO_FACTS,
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
  const focus = deriveNovaFocus(THREAD_FACTS);
  const entries = buildNovaFeed(focus);
  const status = statusForCandidate(focus.primary.kind);
  const choice = entries.find(
    (entry): entry is Extract<NovaEntry, { kind: "nova.choice" }> => entry.kind === "nova.choice",
  );

  const bubbles = speechBubbles(
    entries.filter(
      (entry): entry is Extract<NovaEntry, { kind: "nova.message" }> =>
        entry.kind === "nova.message",
    ),
  );

  return (
    <div className="flex flex-col gap-1.5">
      {bubbles.map((bubble, position) => (
        <Bubble
          key={bubble.key}
          tone={status.tone}
          open={status.open}
          aside={bubble.aside}
          tail={bubble.tail}
          index={position}
        >
          {bubble.paragraphs.map((text) =>
            bubble.aside ? <Context key={text}>{text}</Context> : <Line key={text}>{text}</Line>,
          )}
        </Bubble>
      ))}

      {choice && (
        /*
          The CTA beat, and the control is **outside** the bubble. A bubble
          means Nova is saying something; a Move is something the founder can
          do. Wrapping one in the other makes them a single object when they
          are two, and the question she asks is the only half that is speech.
        */
        <>
          {choice.prompt && (
            <Bubble
              tone={status.tone}
              open={status.open}
              tail={bubbles.at(-1)?.aside ?? true}
              index={bubbles.length}
            >
              <Line>{choice.prompt}</Line>
            </Bubble>
          )}
          <div className="flex max-w-[26rem] flex-col gap-2.5 pt-1">
            {choice.options.map((option) => (
              <Move
                key={option.actionId}
                label={option.label}
                operation={option.price}
              />
            ))}
          </div>
        </>
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
          <p className="text-title font-semibold text-fg">The Bubble</p>
        </div>
        <Context>
          The wireframe&rsquo;s first piece. The Line put the register inside the sentence and it
          was wrong: a rule beside a paragraph is a document grammar, and this surface is somebody
          speaking. The register belongs to the container, so the sentence can go back to being a
          sentence.
        </Context>
        <Context>
          Two axes, and neither is chosen here. <strong className="text-fg">Tone</strong> says what
          kind of thing this is. <strong className="text-fg">Open</strong> says whether a loop is
          still hanging, and is drawn as a dashed contour. Both come from statusForCandidate, which
          is also what the pill on the real Focus Card reads.
        </Context>
      </div>

      {/* ── The appearances ──────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The appearances the twenty-one moments use</Eyebrow>
        <Context>
          Until now every one of them said <em>Blocked</em> — ten different situations, one word,
          one colour. A crashed run, a run nobody can account for, a disconnected source and a
          merge a branch rule refused all read the same. They do not any more, and the words below
          come from the product&rsquo;s vocabulary rather than from this sheet.
        </Context>
        <div className={`flex flex-col divide-y divide-line-1 ${panel}`}>
          {APPEARANCES.map(({ kind, what }, position) => (
            <div key={kind} className="flex flex-col gap-3 p-6">
              <Moment kind={kind} index={position} />
              <p className="study-measure font-mono text-caption text-fg-meta">{what}</p>
            </div>
          ))}
          <div className="flex flex-col gap-3 p-6">
            <Bubble aside index={APPEARANCES.length}>
              <Context>
                The audit behind what I am showing you is older than your product.
              </Context>
            </Bubble>
            <p className="study-measure font-mono text-caption text-fg-meta">
              An aside — something also true, never something to do. Still a bubble: the first
              version gave it no walls, and one large bubble with loose sentences under it does not
              read as a quieter remark, it reads as a bubble that ran out. Quieter contour, no
              tail, because it continues a run rather than opening one.
            </p>
          </div>
        </div>
      </section>

      {/* ── Without colour ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The same six, with hue removed</Eyebrow>
        <Context>
          The test that matters. Four appearances survive: hairline solid, hairline dashed, double
          solid, double dashed. Those carry what somebody scanning needs before they read a word —
          is something wrong, and has anything concluded. Within &ldquo;nothing is wrong&rdquo;,
          hue and the word separate <em>worth starting</em> from <em>your turn</em>, and this sheet
          claims no more than that. The aside is not on this row: it is a neutral bubble and has
          no register to survive.
        </Context>
        <div className={`flex flex-col gap-4 p-6 grayscale ${panel}`}>
          {APPEARANCES.map(({ kind }, position) => (
            <Moment key={kind} kind={kind} index={position} />
          ))}
        </div>
      </section>

      {/* ── The sequence ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>The wireframe&rsquo;s sequence</Eyebrow>
        <Context>
          Statement, the asides that qualify it, then the move it leads to. Every sentence comes
          from buildNovaFeed over one set of facts — a sheet that wrote its own copy would be
          testing the copy. Only the first bubble of a run points at the speaker; an aside has no
          tail at all, so the bubble after it starts a new run. The control sits outside the last
          bubble rather than inside it. This move is a navigation, so nothing is asked before it —
          which is why no bubble precedes it here at all.
        </Context>
        <div className={`p-6 max-sm:p-4 ${panel}`}>
          <Thread />
        </div>
      </section>

      {/* ── Remarks or prose ─────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Several bubbles, or one with paragraphs</Eyebrow>
        <Context>
          Separate bubbles are right for short lines — each one reading as its own beat is the
          texture of the form. They are wrong the moment the lines stop being remarks: three
          paragraphs as three bubbles is three heavy blocks with gutters between them, and the
          gutters claim &ldquo;separate utterances&rdquo; about text that is plainly one thought. So
          a run merges when any line is longer than one line at the bubble&rsquo;s own measure, when
          the run is prose in total, or when there are more than four of them.
        </Context>
        <div className={`grid gap-6 p-6 sm:grid-cols-2 ${panel}`}>
          {SPEECH_RUNS.map(({ label, texts }) => (
            <div key={label} className="flex flex-col gap-2.5">
              <p className="font-mono text-caption text-fg-meta">{label}</p>
              {speechBubbles(
                texts.map((text, index) => ({
                  id: `${label}-${index}`,
                  text,
                  emphasis: "primary" as const,
                })),
              ).map((bubble, position) => (
                <Bubble key={bubble.key} tail={bubble.tail} index={position}>
                  {bubble.paragraphs.map((text) => (
                    <Line key={text}>{text}</Line>
                  ))}
                </Bubble>
              ))}
            </div>
          ))}
        </div>
        <Context>
          Nothing merges across a register. Nova&rsquo;s leading statement and the asides under it
          are different candidates saying different things about different facts, and a bubble is
          one utterance — so the split happens first and the grouping only ever runs inside it.
        </Context>
      </section>

      {/* ── Geometry ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <Eyebrow>Three words, forty words, and a decision</Eyebrow>
        <Context>
          A bubble hugs its content up to a reading measure, the way every chat a founder has used
          does — a three-word remark is not a banner. And nothing executable is ever inside one: a
          bubble means Nova is <em>saying</em> something, a Move is something you can <em>do</em>,
          and a button in a speech bubble makes those one object when they are two.
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
          <Bubble tail={false} index={2}>
            <Line>Re-run the audit against what changed?</Line>
          </Bubble>
          <div className="max-w-[26rem]">
            <Move label="Run the audit" operation="business_audit" />
          </div>
        </div>
      </section>
    </div>
  );
}
