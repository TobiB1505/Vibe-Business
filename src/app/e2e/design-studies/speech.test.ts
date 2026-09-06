import { describe, expect, it } from "vitest";
import {
  groupSpeech,
  SPEECH_PARAGRAPH_CHARS,
  SPEECH_RUN_CHARS,
  SPEECH_RUN_MESSAGES,
} from "./speech";

const remark = "There is a change waiting for you to look at.";
const paragraph = "x".repeat(SPEECH_PARAGRAPH_CHARS + 1);

describe("grouping a run of sentences into bubbles", () => {
  it("leaves short remarks as separate bubbles", () => {
    expect(groupSpeech([remark, "My last audit did not finish."])).toEqual([
      [remark],
      ["My last audit did not finish."],
    ]);
  });

  it("gives a single sentence one bubble whatever its length", () => {
    expect(groupSpeech([paragraph])).toEqual([[paragraph]]);
  });

  it("merges a run the moment one of its lines is a paragraph", () => {
    // The whole run merges, not just the long line: a bubble whose neighbours
    // stayed separate would make one thought look like two conversations.
    expect(groupSpeech([remark, paragraph])).toEqual([[remark, paragraph]]);
  });

  it("merges a run that is prose in total even when every line is short", () => {
    const short = "y".repeat(SPEECH_PARAGRAPH_CHARS - 10);
    const many = [short, short, short, short];
    expect(many.reduce((sum, text) => sum + text.length, 0)).toBeGreaterThan(SPEECH_RUN_CHARS);
    expect(groupSpeech(many)).toEqual([many]);
  });

  it("merges on count once a run stops being remarks", () => {
    const tiny = Array.from({ length: SPEECH_RUN_MESSAGES + 1 }, (_, index) => `no ${index}`);
    expect(groupSpeech(tiny)).toEqual([tiny]);
    // One fewer is still a set of remarks.
    expect(groupSpeech(tiny.slice(0, SPEECH_RUN_MESSAGES))).toHaveLength(SPEECH_RUN_MESSAGES);
  });

  it("never returns a mixture", () => {
    // Every run is all-separate or all-merged. A run whose shape changed one
    // bubble at a time as sentences grew would be unreadable to design against.
    for (const run of [[remark, remark], [remark, paragraph], [paragraph, paragraph]]) {
      const bubbles = groupSpeech(run);
      expect(bubbles.length === 1 || bubbles.every((bubble) => bubble.length === 1)).toBe(true);
    }
  });

  it("holds on nothing", () => {
    expect(groupSpeech([])).toEqual([]);
  });
});
