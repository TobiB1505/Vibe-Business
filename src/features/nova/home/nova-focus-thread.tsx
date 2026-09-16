import { NovaBubble } from "@/components/nova/nova-bubble";
import { speechBubbles } from "@/components/nova/nova-speech";
import { NovaAside, NovaLine, NovaRenderBlock } from "@/components/nova/nova-thread";
import { statusForCandidate } from "@/components/system/status-vocabulary";
import { BLOCK_FOR_MOMENT, type BlockKind } from "@/modules/nova/blocks";
import type { NovaHomeEntry } from "@/modules/nova/home-view";
import type { ReactNode } from "react";
import { footnoteFor } from "./footnote";

/**
 * The one thing that matters, as the thread draws it.
 *
 * ## What replaced the Focus Card, and why
 *
 * A card. It held Nova's sentence, the subject's own sentence, whatever
 * context the page could supply and the control, inside one raised surface —
 * which is a dashboard tile with a paragraph in it. The wireframe's whole
 * argument is that this surface is somebody speaking: a sentence in a bubble,
 * then the thing she made, then what you can do about it. Three objects, none
 * inside another.
 *
 * So the card became a thread. Nothing about the ranking changed and no
 * sentence was rewritten — `buildNovaHomeView` still decides what leads and
 * `novaCandidateMessage` still writes it.
 *
 * ## Where Nova's own writing enters
 *
 * As a second bubble, `voice`, and never as a replacement. The moment sentence
 * is always current and always Vibe's; hers is what she wrote about the
 * document when she made it. A founder reads one run of two lines, and the
 * thread degrades to exactly its old self when nothing was written — which is
 * the ordinary case and has to look deliberate rather than broken.
 *
 * ## The register is on the bubble
 *
 * `statusForCandidate` gives both axes: `tone` for what kind of thing this is,
 * and `open` for whether a loop is still hanging, drawn as a dashed contour.
 * The bubble cannot describe a moment differently from the word beside it,
 * because both come from the same table.
 *
 * ## Why this does not stage its arrival, and the opening does
 *
 * `NovaArriving` exists, it is what the opening screen uses, and it is
 * deliberately not used here.
 *
 * The opening's messages are genuinely arriving: it happens once per project,
 * there is nothing on screen a founder could already have read, and the
 * composing beat is the difference between somebody speaking and a list
 * rendering. Home is the opposite. Nothing here is appended — the whole thread
 * is re-derived from rows on every load, so it is the same thread it was last
 * time, and staging it would make a founder wait two seconds to read what they
 * had already read. That is the cost the component's own docblock names, in
 * the case where there is nothing to buy with it.
 *
 * What Home has instead is the CSS entrance: `bubble-arrive`, delayed by
 * `--i * 70ms`, which is why every object below takes an `index` in reading
 * order. The thread still arrives in sequence — it just does it in a quarter
 * of a second and without claiming Nova is typing.
 *
 * The case that would earn staging is a message that lands *while a founder is
 * looking*, when the header's poll refreshes the route after a run settles.
 * That needs the thread to know which part is new, and Home holds no read
 * marker by decision — the "while you were away" line was removed on the
 * argument that nothing here happens without the founder. So it is written
 * down as the open question rather than approximated.
 *
 * ## Why the block is asked for rather than chosen here
 *
 * `BLOCK_FOR_MOMENT` is total over every moment the domain can raise, so a new
 * one fails the build until somebody decides what a founder sees. This asks it
 * and renders what the caller could supply; a kind with no data in hand draws
 * no block, which is the honest answer — a placeholder would be a frame around
 * an absence.
 */
export function NovaFocusThread({
  entry,
  /**
   * What Nova wrote about the document this moment is about, when she has.
   *
   * A second bubble in the same run, never a replacement: `entry.message` says
   * what is open *now* and is always current, while this says what she found
   * when she made the thing — two different claims in the same voice, which is
   * exactly what a run of bubbles is for. Absent is the ordinary state.
   */
  voice,
  /**
   * The run in flight, when one is and its kind draws something.
   *
   * Below the moment rather than instead of it, because the two are different
   * questions: the moment is what needs deciding, and this is what is
   * happening while it waits.
   *
   * It used to be the progress checklist and nothing else, which meant a
   * founder who started a Product Scan from here watched a blank column while
   * it ran. `BLOCK_FOR_OPERATION` already decided what each kind of run shows;
   * this asks it the same way the moment asks `BLOCK_FOR_MOMENT`, so a run
   * with a block draws it and a run without one draws nothing.
   */
  running,
  /** The block for this moment, when the surface could read its subject. */
  block,
  /**
   * The other things that are also true, in Nova's quiet register.
   *
   * ## Why they came back
   *
   * They were a *stack of cards* under the thread and they were removed for
   * being that — panels stapled to a conversation, each with its own frame and
   * its own control, which is the wall of equally weighted choices Nova exists
   * to replace. What went with them was the information: `buildNovaHomeView`
   * has been computing `secondary` and Home has been discarding it, so a
   * founder with three things pending saw one and never learned of the other
   * two.
   *
   * A quiet line is not a card. These carry **no controls and no prices** —
   * `buildNovaFeed` has made the same argument for its own asides since before
   * this surface existed: they exist so that a second true thing is not
   * silently unreachable, which is the entire reason the focus is a ranking,
   * and giving each one a button would rebuild the wall.
   *
   * ## Why they are grouped rather than listed
   *
   * `speechBubbles` decides. Two short remarks are two bubbles; a run of five
   * is one bubble with line breaks, because five separate grey blocks stacked
   * with gutters is a list wearing a chat's clothes. It is the same rule the
   * opening uses on Nova's introduction, asked here for the same reason.
   *
   * Vibe's own line about the evidence under this moment arrives here too,
   * first in the run — it is the same kind of thing, a quiet line with no
   * control, and giving it a prop of its own would have put two nearly
   * identical names on one component. `briefing/aside.ts` decides whether it
   * is said at all.
   */
  asides,
  /** What the founder can do. Outside the bubble, as every control is. */
  control,
  /**
   * The control's own words, so the question above it can decline to repeat
   * them. Absent means there is nothing to collide with.
   */
  controlLabel,
}: {
  entry: NovaHomeEntry;
  voice?: string | null;
  running?: { kind: BlockKind; node: ReactNode };
  asides?: readonly string[];
  block?: ReactNode;
  control?: ReactNode;
  controlLabel?: string;
}) {
  const status = statusForCandidate(entry.kind);
  const kind = BLOCK_FOR_MOMENT[entry.kind];

  /*
   * The question she asks before the control, when it says something the
   * button does not. `footnoteFor` is the rule: "Merge it?" above a button
   * labelled "Merge it" is one act with two names, and it returns null there.
   */
  const prompt = footnoteFor(entry.prompt, controlLabel);

  /*
   * Whether the block is about to repeat the aside. Only when there *is* a
   * block: without one the subject's sentence is the only place a founder
   * learns which step, which Move or which question this is.
   */
  const saysTheDetail = block !== undefined && kind !== "none" && BLOCK_SAYS_THE_DETAIL[kind];

  /*
   * One register, so `speechBubbles` has one run to group. It splits by
   * register first and these are all asides, which is why the sentences can be
   * handed over flat.
   */
  const asideBubbles = speechBubbles(
    (asides ?? []).map((text, position) => ({
      id: String(position),
      text,
      emphasis: "aside" as const,
    })),
  );

  return (
    <section className="flex flex-col gap-2.5" aria-label="What needs your attention">
      <NovaBubble tone={status.tone} open={status.open} index={0}>
        <NovaLine>{entry.message}</NovaLine>
      </NovaBubble>

      {/*
        What she wrote when she made the thing. No tail: it is the same speaker
        continuing, which is the phone's own rule and the one `speechBubbles`
        applies to a run.
      */}
      {voice && (
        <NovaBubble tone={status.tone} open={status.open} tail={false} index={1}>
          <NovaLine>{voice}</NovaLine>
        </NovaBubble>
      )}

      {/*
        The subject's own sentence, in the quieter register. A change's headline
        and a question's text are written by the thing they are about, never by
        Nova — so they are an aside rather than a second claim of hers.

        Unless the block below is about to say the same words. Three of them do
        — see `BLOCK_SAYS_THE_DETAIL` — and there the aside was the sentence
        immediately above a heading repeating it in thirty-two point type.
      */}
      {entry.detail && !saysTheDetail && (
        <NovaBubble aside tail={false} index={2}>
          <NovaAside>{entry.detail}</NovaAside>
        </NovaBubble>
      )}

      {prompt && (
        <NovaBubble tone={status.tone} open={status.open} tail={false} index={3}>
          <NovaLine>{prompt}</NovaLine>
        </NovaBubble>
      )}

      {block && kind !== "none" && (
        <NovaRenderBlock
          label={BLOCK_LABEL[kind]}
          namesItself={BLOCK_NAMES_ITSELF[kind]}
          tone={status.tone}
          index={4}
        >
          {block}
        </NovaRenderBlock>
      )}

      {running && (
        <NovaRenderBlock
          label={BLOCK_LABEL[running.kind]}
          namesItself={BLOCK_NAMES_ITSELF[running.kind]}
          tone="active"
          index={5}
        >
          {running.node}
        </NovaRenderBlock>
      )}

      {control && <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">{control}</div>}

      {/*
        After the control, because they are about other moments and the control
        belongs to this one. A founder reads the thing to do, sees the button
        for it, and then hears what else is true — which is the order a person
        speaks in, and the order `buildNovaFeed` already put them in.
      */}
      {asideBubbles.map((bubble, position) => (
        <NovaBubble key={bubble.key} aside tail={false} index={5 + position}>
          {bubble.paragraphs.map((text) => (
            <NovaAside key={text}>{text}</NovaAside>
          ))}
        </NovaBubble>
      ))}
    </section>
  );
}

/**
 * What a block calls itself, above its own frame.
 *
 * Short, and a noun rather than a sentence: the block's contents say what they
 * are, and a label that explained them would be the caption problem this
 * surface keeps removing. `none` has no label because it has no block.
 */
const BLOCK_LABEL: Record<BlockKind, string> = {
  audit: "Business audit",
  scan: "Product scan",
  agent: "Building",
  ready: "The step to build",
  review: "The change",
  move: "Next move",
  ask: "Needs your answer",
  progress: "Working on it",
  none: "",
};

/**
 * Which blocks write their own name, so the frame does not write it again.
 *
 * A composed surface sometimes carries its own heading — the Product Scan
 * writes "Product scan · live" — and a frame that printed the label above it
 * put the same words on screen twice. That is the duplication this whole
 * surface keeps removing, so it is decided here, once, total over the kinds,
 * rather than remembered at each call site.
 *
 * The test is whether the two say the *same* thing, not whether the block has
 * a heading at all. The agent's list says "Files touched", which is a section
 * inside a block called "Building" — one names what is being shown and the
 * other names what is happening, and dropping the frame's label there left the
 * record on screen with nothing saying it was a run in progress. It was set
 * true here for one commit on the strength of "it has its own title", and
 * looking at the rendered block is what caught it.
 *
 * The label still travels: it is the region's accessible name either way.
 */
/**
 * Which blocks print the subject's own sentence, so the aside does not.
 *
 * `entry.detail` is written by the thing the moment is about — a step's title,
 * a Move's title, a question's text — and three of the composed surfaces open
 * by printing exactly that string as their heading. A thread that drew both
 * said the same words twice, three lines apart, the second time at four times
 * the size. The offer was the worst of them: *"Add a clear pricing section to
 * your website"* as a grey aside, then again as the task panel's headline.
 *
 * It is decided here rather than at the call sites for the reason the label
 * table above is: total over the kinds, so a new block has to answer the
 * question, and one place to look when a block's heading changes.
 *
 * False is the safe answer and the common one. A block that merely *mentions*
 * the subject is not repeating the sentence — the review gates carry a
 * change's stage sentence, which is a different claim from its headline — and
 * dropping the aside there would remove the only line naming what this is
 * about.
 */
const BLOCK_SAYS_THE_DETAIL: Record<BlockKind, boolean> = {
  audit: false,
  scan: false,
  agent: false,
  /* `AgentTaskPanel` opens with the step title, which is the detail exactly. */
  ready: true,
  review: false,
  /* `MoveCard` prints `opportunity.title`; the detail is that title. */
  move: true,
  /* `FounderInputCard` prints `request.question`; the detail is the question. */
  ask: true,
  progress: false,
  none: false,
};

const BLOCK_NAMES_ITSELF: Record<BlockKind, boolean> = {
  audit: false,
  scan: true,
  agent: false,
  /* The task panel names the step and the offer names the price; neither says
     what the block is, which is the step being offered. */
  ready: false,
  review: false,
  move: false,
  ask: false,
  progress: false,
  none: false,
};
