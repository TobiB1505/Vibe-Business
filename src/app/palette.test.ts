import { describe, expect, it } from "vitest";
import { activePalette, PALETTE_ENV } from "./palette";

/**
 * The switch is one function, and its default is what customers have.
 *
 * The failure this guards is not a broken palette — it is a deployment that
 * renders v2 because somebody set `VIBE_PALETTE=V2`, `vibe2`, `true` or
 * `1` and the resolver was generous. A cosmetic flag that answers to four
 * spellings is a flag nobody can reason about from the Vercel dashboard.
 */
describe("the palette comes from configuration, and defaults to v1", () => {
  it("is v1 when nothing is set", () => {
    expect(activePalette({})).toBe("v1");
  });

  it("is v2 for exactly one value", () => {
    expect(activePalette({ [PALETTE_ENV]: "v2" })).toBe("v2");
    // Whitespace only, because a value pasted into a dashboard often carries
    // some and that is not a different intent.
    expect(activePalette({ [PALETTE_ENV]: " v2 " })).toBe("v2");
  });

  it.each(["V2", "2", "true", "1", "on", "vibe2", "v1", ""])(
    "is v1 for %s, rather than guessing",
    (value) => {
      expect(activePalette({ [PALETTE_ENV]: value })).toBe("v1");
    },
  );

  it("reads the variable the deployment doc names", () => {
    // One string, in one place. A doc that names a different variable than the
    // code reads is worse than no doc.
    expect(PALETTE_ENV).toBe("VIBE_PALETTE");
  });
});
