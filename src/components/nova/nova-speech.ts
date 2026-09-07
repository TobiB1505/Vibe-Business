/**
 * When a run of sentences is several bubbles and when it is one.
 *
 * ## The observation this encodes
 *
 * Separate bubbles are right for short lines. A phone chat is full of them —
 * "?", "Ging als sträfling", "Hab vibration nicht gespürt" — and each one
 * reading as its own beat is the whole texture of the form.
 *
 * They are wrong the moment the lines stop being remarks. Three paragraphs as
 * three bubbles is three heavy blocks stacked with gutters between them, and
 * the gutters say "these are separate utterances" about text that is plainly
 * one thought. A real chat does the same thing: a long message arrives as one
 * bubble with line breaks inside it, not as four.
 *
 * ## The rule, and why each half of it exists
 *
 * A run becomes one bubble when it has stopped being remarks, which shows up
 * three ways and any one is enough:
 *
 * - **A message longer than one line at the bubble's own measure.** That is
 *   what makes something a paragraph rather than a remark, and it is why the
 *   threshold is tied to `max-w-[46ch]` rather than picked round.
 * - **A run long enough to be prose even if every line is short.** Six short
 *   sentences in a row is a monologue delivered one bubble at a time.
 * - **More than four messages**, for the same reason, counted rather than
 *   measured — a run of very short lines gets there on count before length.
 *
 * ## What it must never merge
 *
 * Only sentences of the same kind. Nova's leading statement and the asides
 * under it are different candidates — different things being said about
 * different facts — and a bubble is one utterance. The caller splits runs by
 * register first and asks this only within a run, which is why this function
 * takes a flat list and has no opinion about registers at all.
 */

/** One line at `max-w-[46ch]`, past which a message wraps and reads as prose. */
export const SPEECH_PARAGRAPH_CHARS = 90;

/** The run as a whole, when every line is short but there are many of them. */
export const SPEECH_RUN_CHARS = 300;

/** Counted rather than measured, for runs of very short lines. */
export const SPEECH_RUN_MESSAGES = 4;

/**
 * Group one register's sentences into bubbles.
 *
 * Returns one array per bubble, each holding that bubble's paragraphs. Either
 * every sentence gets its own bubble, or they all share one — never a mixture,
 * because a run that is half remarks and half prose is a run whose shape would
 * change as a sentence somewhere in it got a word longer.
 */
export function groupSpeech(texts: readonly string[]): string[][] {
  if (texts.length <= 1) return texts.map((text) => [text]);

  const total = texts.reduce((sum, text) => sum + text.length, 0);
  const prose =
    texts.some((text) => text.length > SPEECH_PARAGRAPH_CHARS) ||
    total > SPEECH_RUN_CHARS ||
    texts.length > SPEECH_RUN_MESSAGES;

  return prose ? [[...texts]] : texts.map((text) => [text]);
}

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
