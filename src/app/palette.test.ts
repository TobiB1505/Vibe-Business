import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  activePalette,
  PALETTE_BOOT_SCRIPT,
  PALETTE_ENV,
  PALETTE_STORAGE_KEY,
  paletteSwitchable,
} from "./palette";

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

/**
 * The local switch, and the two things that make it safe to have.
 *
 * It exists because every screen in the redesign has to be checked in both
 * palettes, and the environment variable takes effect at build time. That is a
 * good reason for a tool and no reason at all to hand a customer a choice
 * between a finished design and an unfinished one.
 */
describe("the local switch is a tool, not a preference", () => {
  it("is absent in production and present everywhere else", () => {
    expect(paletteSwitchable({ VERCEL_ENV: "production" })).toBe(false);
    expect(paletteSwitchable({ VERCEL_ENV: "preview" })).toBe(true);
    expect(paletteSwitchable({ VERCEL_ENV: "development" })).toBe(true);
    // No Vercel at all resolves through the app URL: unset falls back to
    // localhost, which is development — where most of the redesign is looked
    // at. A real URL configured by hand reads as production, because somebody
    // who set one did it to run production-like.
    expect(paletteSwitchable({})).toBe(true);
    expect(paletteSwitchable({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).toBe(true);
    expect(paletteSwitchable({ NEXT_PUBLIC_APP_URL: "https://vibebusiness.de" })).toBe(false);
  });

  it("renders the switch only behind that gate", () => {
    // A control that appears in production because somebody dropped the
    // condition is the failure this exists for, and it is invisible in every
    // local run.
    const menu = readFileSync("src/components/layout/account-menu.tsx", "utf8");
    expect(menu).toContain("{paletteSwitchable() && <PaletteSwitch");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("{paletteSwitchable() && (");
  });

  it("names the storage key once, and the boot script reads that name", () => {
    // The key appears in the component, in the boot script and in the browser
    // test. Three literals is how one of them ends up spelled differently and
    // the override silently stops being remembered.
    expect(PALETTE_STORAGE_KEY).toBe("vibe-palette");
    expect(PALETTE_BOOT_SCRIPT).toContain(JSON.stringify(PALETTE_STORAGE_KEY));
    expect(readFileSync("src/components/layout/palette-switch.tsx", "utf8")).toContain(
      "PALETTE_STORAGE_KEY",
    );
  });

  it("keeps the boot script unable to throw", () => {
    // It runs before the parser continues. An exception in a blocking head
    // script stops the document, and `localStorage` throws in a private
    // window — so the try/catch is not defensive style, it is the contract.
    expect(PALETTE_BOOT_SCRIPT.startsWith("try{")).toBe(true);
    expect(PALETTE_BOOT_SCRIPT).toContain("catch");
    // And it only ever writes a value the palette actually has.
    expect(PALETTE_BOOT_SCRIPT).toContain('p==="v1"||p==="v2"');
  });
});
