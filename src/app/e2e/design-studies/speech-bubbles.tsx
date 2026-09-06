import { groupSpeech } from "./speech";

/**
 * A feed's messages, resolved into the bubbles that will carry them.
 *
 * ## Two decisions, taken in order, and the order matters
 *
 * First **split by register**: Nova's leading statement and the asides under
 * it are different candidates, saying different things about different facts,
 * and a bubble is one utterance. Nothing may merge across that line however
 * short the sentences are.
 *
 * Then **group within a register** by `groupSpeech`, which decides whether a
 * run reads as remarks or as prose.
 *
 * Doing it the other way round would merge a statement with an aside whenever
 * the pair happened to be long, which is the merge that is actually wrong.
 *
 * ## The tail
 *
 * Only the first bubble of a *speaking* run points at the speaker. An aside
 * does not speak, so it never carries one and it breaks the run — the bubble
 * after an aside opens a new one. That is the phone's own rule, and a tail on
 * every bubble reads as several people talking at once.
 */
export type SpeechBubble = {
  /** Stable across renders: the first sentence the bubble carries. */
  key: string;
  aside: boolean;
  tail: boolean;
  paragraphs: string[];
};

export function speechBubbles(
  messages: readonly { id: string; text: string; emphasis: "primary" | "aside" }[],
): SpeechBubble[] {
  /* Runs of one register, in order. */
  const runs = messages.reduce<{ aside: boolean; texts: string[] }[]>((rows, message) => {
    const aside = message.emphasis === "aside";
    const previous = rows.at(-1);
    if (previous && previous.aside === aside) {
      return [...rows.slice(0, -1), { aside, texts: [...previous.texts, message.text] }];
    }
    return [...rows, { aside, texts: [message.text] }];
  }, []);

  const bubbles = runs.flatMap((run) =>
    groupSpeech(run.texts).map((paragraphs) => ({ aside: run.aside, paragraphs })),
  );

  return bubbles.map((bubble, index) => ({
    key: bubble.paragraphs[0] ?? String(index),
    aside: bubble.aside,
    /* Speaking, and the thing before it was not. */
    tail: !bubble.aside && (index === 0 || (bubbles[index - 1]?.aside ?? false)),
    paragraphs: bubble.paragraphs,
  }));
}
