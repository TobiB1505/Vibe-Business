import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What Nova's components may contain, asserted against their source (§K).
 *
 * Most of Nova's language is already checked as data — the sentences live in
 * `feed.ts` and the labels in `actions.ts`, and `feed.test.ts` sweeps them as
 * values. What is left for a source contract is the class of regression a
 * value test cannot see: a sentence typed straight into JSX, a chat box, a
 * price hardcoded beside a button, a second copy of a stage label.
 *
 * The same technique and the same comment-stripping as
 * `command-center-ui.test.ts`, for the same reason: the comments here quote
 * the very words the assertions forbid, in order to explain why the screens
 * never say them.
 */

const DIR = join(process.cwd(), "src/components/nova");
const FILES = ["nova-feed.tsx", "nova-message.tsx", "nova-choice.tsx"];

function source(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/** Comments and imports removed: what is left is what renders. */
function rendered(file: string): string {
  return source(file)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^import[\s\S]*?;$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("Nova's components hold no copy of their own", () => {
  /**
   * The one rule the whole slice rests on. Every sentence a founder reads
   * comes from `feed.ts` or `actions.ts`, so every sentence is swept by a
   * value test. A string typed into JSX is a string no test reads — and the
   * first one to appear would be the one that promised something.
   */
  it("renders no prose that did not come from an entry", () => {
    const literalProse = /(?:>|\}\s)\s*[A-Z][a-z]+[^<{}]{12,}</g;

    /*
     * Proved live first: a sweep asserting "no matches" passes identically
     * when the pattern is broken and when the source is clean, and the whole
     * value of the test is the difference between those two.
     */
    const planted = '<p className="x">This moves your default branch and runs your CI.</p>';
    expect(planted.match(literalProse)).not.toBeNull();

    for (const file of FILES) {
      const jsxText = rendered(file).match(literalProse) ?? [];
      expect(jsxText, `${file} contains literal prose`).toEqual([]);
    }
  });

  it("prints no price of its own", () => {
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/\d+\s*Credits/i);
    }
  });

  it("names no stage of its own", () => {
    /* One table owns that copy, and the progress row reads from it. */
    expect(rendered("nova-feed.tsx")).toContain("OPERATION_STAGE_LABELS[");
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/"(preparing_workspace|running_agent|installing)"/);
    }
  });
});

describe("Nova offers no surface the product does not have", () => {
  /**
   * §M: no unrestricted chat input. Nothing in this product reads free text
   * into a decision except two allowlisted, length-bounded fields that belong
   * to their own domains. A box on the feed would be a third, unbounded one.
   */
  it("has no text input of any kind", () => {
    for (const file of FILES) {
      const markup = rendered(file);
      expect(markup, file).not.toMatch(/<(input|textarea)\b/);
      expect(markup, file).not.toMatch(/contentEditable/);
    }
  });

  /** A feed is a render of current state, not a record of what happened. */
  it("keeps no transcript", () => {
    for (const file of FILES) {
      expect(rendered(file), file).not.toMatch(/\b(transcript|history|messages\[)\b/i);
    }
  });
});

describe("progress reads as progress", () => {
  /**
   * Named stages and no percentage, everywhere in the product
   * (`operations/schema.ts:16-19`). A bar implies a rate, and nothing here
   * knows one.
   */
  it("draws no percentage or progress bar", () => {
    const markup = rendered("nova-feed.tsx");

    expect(markup).not.toMatch(/%/);
    expect(markup).not.toMatch(/role="progressbar"/);
    expect(markup).not.toMatch(/\bpercent|\bprogressBar\b/i);
  });
});

describe("the confirmation", () => {
  /** The note is the catalog's, so the two confirmed controls can differ. */
  it("reads its wording from the option rather than stating one", () => {
    expect(rendered("nova-choice.tsx")).toContain("option.confirmationNote");
  });

  it("confirms only what the catalog says to confirm", () => {
    expect(rendered("nova-choice.tsx")).toContain("option.requiresConfirmation");
  });
});

/**
 * One reading of the motion preference, and it has to be the server's.
 *
 * ## What this caught
 *
 * `NovaPresence` read the preference through Motion's `useReducedMotion`,
 * which answers from a media query the browser has already evaluated before
 * React hydrates. A reader with `prefers-reduced-motion: reduce` therefore got
 * a client first render that disagreed with the server's — the server emitted
 * the mark's keyframe `<style>` and the client did not — and React responded
 * by discarding the subtree and rebuilding it. On every page that mounts the
 * mark: the landing page, Nova's rail, her status row.
 *
 * Typecheck, lint and the whole suite were green through all of it. What found
 * it was opening a page in a browser with the preference set.
 *
 * ## Why the assertion is about the import
 *
 * Because the mechanism is the fix. `useMotionAllowed` is a
 * `useSyncExternalStore` whose server snapshot is "no motion", so the two
 * agree by construction rather than by timing — and there is no way to write
 * that as a value test, because the defect only exists across the boundary
 * between two renders in two runtimes.
 */
describe("the mark's motion preference", () => {
  it("comes from the store with a server snapshot, not from the media query", () => {
    const presence = source("nova-presence.tsx");

    expect(presence).toContain("useMotionAllowed");
    /* The import, not the word: the docblock above this test names the hook it
       replaced, and a bare substring sweep would match its own explanation. */
    expect(presence).not.toMatch(/import \{[^}]*useReducedMotion[^}]*\} from "motion\/react"/);
  });

  /*
   * The one copy. Two readings of one preference is how a screen ends up
   * half-staged — the thread present from the first frame while the mark
   * beside it is still assembling — which is the argument `nova-motion.ts`
   * makes for itself.
   */
  it("is the same store the staged arrival uses", () => {
    expect(source("nova-motion.ts")).toContain("useSyncExternalStore");
    expect(source("nova-arriving.tsx")).toContain("useMotionAllowed");
  });
});

/**
 * The dissolving stages, and the two rules they state.
 *
 * ## What this caught
 *
 * Both of the component's last two rules were written in its docblock and
 * neither was implemented.
 *
 * The reduced-motion rule said the faded lines are not rendered. The
 * stylesheet's reduced-motion block set the container to `opacity: 1` and
 * stopped its animation, which removes the fading and leaves the stale stages
 * standing there — the opposite of the rule.
 *
 * The timer rule said a line goes because it stopped being true, never on a
 * timer. The container animated to `opacity: 0` over 420ms `both`, from mount:
 * every past stage vanished on a timer whatever the run was doing, and the
 * emptied box kept its height for the rest of the run. In production the
 * element was therefore invisible within half a second of appearing, under a
 * permanent gap.
 *
 * Neither is expressible as a value test — one is about which elements exist
 * across two runtimes, the other about what a stylesheet does after 420ms — so
 * both are asserted against the source, and both were confirmed in a browser
 * before being written down.
 */
describe("the dissolving stages", () => {
  it("renders no past stage under reduced motion", () => {
    const dissolving = rendered("nova-dissolving.tsx");

    expect(dissolving).toContain("useMotionAllowed");
    /* The gate is on the fading block, not on the current stage: the stage a
       run is at is information, and reduced motion does not remove it. */
    expect(dissolving).toMatch(/motion && fading\.length > 0 &&/);
    expect(dissolving).toMatch(/nova-thinking/);
  });

  it("fades by position rather than by timer", () => {
    const dissolving = rendered("nova-dissolving.tsx");

    /* Opacity comes from where a line sits, and only the stage changing can
       move it. Nothing in here starts on its own. */
    expect(dissolving).toMatch(/opacity: index === 0 \? 0\.55 : 0\.28/);
    expect(dissolving).not.toMatch(/animation|nova-dissolve|setTimeout|setInterval/);
  });

  it("leaves no timer class behind in the stylesheet", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    expect(css).not.toContain("nova-dissolve");
  });
});
