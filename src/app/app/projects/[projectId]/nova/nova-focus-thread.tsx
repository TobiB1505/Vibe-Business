import { NovaBubble } from "@/components/nova/nova-bubble";
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
   * Vibe's own line about the evidence under this moment, when there is no
   * written sentence to carry it and it says something the moment does not.
   *
   * An aside, because it is context rather than a claim of Nova's about what
   * is open. `briefing/aside.ts` decides whether it appears at all.
   */
  aside,
  /** The block for this moment, when the surface could read its subject. */
  block,
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
  aside?: string | null;
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
        The quieter half: Vibe's reading of the evidence underneath, when Nova
        has not spoken. It never appears beside her own sentence — she was given
        the same facts and decided for herself whether to use them.
      */}
      {aside && (
        <NovaBubble aside tail={false} index={1}>
          <NovaAside>{aside}</NovaAside>
        </NovaBubble>
      )}

      {/*
        The subject's own sentence, in the quieter register. A change's headline
        and a question's text are written by the thing they are about, never by
        Nova — so they are an aside rather than a second claim of hers.
      */}
      {entry.detail && (
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
        <NovaRenderBlock label={BLOCK_LABEL[kind]} tone={status.tone} index={4}>
          {block}
        </NovaRenderBlock>
      )}

      {control && <div className="flex max-w-[24rem] flex-col gap-2.5 pt-1">{control}</div>}
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
  review: "The change",
  move: "Next move",
  ask: "Needs your answer",
  progress: "Working on it",
  none: "",
};
