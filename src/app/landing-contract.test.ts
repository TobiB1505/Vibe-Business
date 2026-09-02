import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What the front door is allowed to say, and where it is allowed to send people
 * (UI-S1 §3–§7, §28, §29).
 *
 * ## Why these are source assertions
 *
 * Because what is being pinned is *copy and destinations*, and both are decided
 * in the file rather than derived from anything a unit test could call. The
 * browser suite renders the same page and checks it survives a phone; this
 * checks the claims, which a screenshot cannot.
 *
 * ## The four regressions these exist to catch
 *
 * A primary call to action pointing at `/login`, the self-negating "not built
 * yet" copy coming back, developer vocabulary reaching a stranger, and the
 * legal surfaces quietly losing their links — which is the one that would be
 * hardest to notice, because the pages would still exist.
 */

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * The file with its commentary removed.
 *
 * Banned-copy assertions are about what a visitor reads, and a comment is not
 * that. The distinction is load-bearing rather than pedantic: the landing page
 * documents the sentence it replaced — "the core loop described in PRODUCT.md
 * is not built yet" — and that explanation is the reason the sentence will not
 * quietly come back. Asserting over raw source would force the code to forget
 * its own history in order to pass.
 */
function copyOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const LANDING = read("src/app/page.tsx");
const SHELL = read("src/components/layout/marketing-shell.tsx");
/*
 * The proof section the landing page actually renders (UI-19).
 *
 * It was `business-map-preview.tsx` until the redesign; nothing imports that
 * file any more, and a contract pointed at an unrendered component guards
 * nothing. This is the component a visitor meets.
 */
const PROOF = read("src/components/marketing/landing-business-brain.tsx");
const SIGNUP = read("src/app/signup/page.tsx");

const PRIVACY = read("src/app/privacy/page.tsx");
const TERMS = read("src/app/terms/page.tsx");

/** Everything a stranger reads before they have an account, comments removed. */
const PUBLIC_SURFACES: [string, string][] = [
  ["landing", copyOf(LANDING)],
  ["marketing shell", copyOf(SHELL)],
  ["product proof", copyOf(PROOF)],
  ["signup", copyOf(SIGNUP)],
  ["privacy", copyOf(PRIVACY)],
  ["terms", copyOf(TERMS)],
];

/**
 * The pages that sell, as opposed to the ones that disclaim.
 *
 * Separate because the terms page has to be able to say "Vibe does not
 * guarantee revenue", and a banned-substring sweep cannot tell a denial from a
 * promise. The sales surfaces make no such claim in either direction.
 */
const SELLING_SURFACES: [string, string][] = [
  ["landing", copyOf(LANDING)],
  ["marketing shell", copyOf(SHELL)],
  ["product proof", copyOf(PROOF)],
];

describe("the landing page sends people the right way", () => {
  /**
   * The claim, restated for the page as it is (UI-19).
   *
   * It used to compare the hero's first `/signup` against its first `/login`,
   * because the hero carried both. The redesigned hero carries one destination
   * — sign-up — and signing in moved to the marketing shell, which every
   * public page wears. The regression being guarded has not changed: a
   * stranger with no account must not be asked to sign in first. So the
   * assertion is now the stronger form of the same thing.
   */
  it("points the first control on the page at signing up, not signing in", () => {
    expect(LANDING).toContain('href="/signup"');

    const firstCta = LANDING.indexOf('href="/signup"');
    const firstSignIn = LANDING.indexOf('href="/login"');
    expect(firstCta).toBeGreaterThan(-1);
    // Either the page offers no sign-in of its own, or sign-up comes first.
    if (firstSignIn > -1) expect(firstCta).toBeLessThan(firstSignIn);
  });

  /**
   * A paid plan's button says where it was going.
   *
   * Every plan card pointed at `/signup` and stopped there, so a visitor who
   * had just chosen Builder landed signed in with no mention of paying and no
   * route to it — the one real gap on a pricing section that was otherwise
   * complete. Asserted here rather than in a component test because it is a
   * claim about the page a stranger sees.
   */
  it("carries a chosen paid plan through signup to the billing surface", () => {
    expect(LANDING).toContain('/signup?next=${encodeURIComponent("/app/billing")}');
    // The free plan has nothing to pay for, so it keeps the plain destination.
    expect(LANDING).toContain('plan.key === "free"');
  });

  it("still offers signing in, on every public page", () => {
    // In the shell rather than in the hero since UI-19. An existing customer
    // must always find the way back in; where it sits is a design decision,
    // whether it exists is not.
    expect(SHELL).toContain('href="/login"');
    expect(SHELL).toContain("Sign in");
  });

  /**
   * Asserted as routes rather than as literal `href="…"`, because the footer
   * builds its links from a list. The browser suite is what proves they render
   * and navigate; this only pins that the shell still knows about them.
   */
  it("links both legal surfaces from the shell every public page wears", () => {
    for (const route of ["/privacy", "/terms", "/login"]) {
      expect(SHELL, route).toContain(`"${route}"`);
    }
    expect(SHELL).toContain('aria-label="Footer"');
  });

  it("links the terms and privacy notice at the moment of agreeing to them", () => {
    expect(SIGNUP).toContain('href="/terms"');
    expect(SIGNUP).toContain('href="/privacy"');
  });
});

describe("the landing page describes the product that exists", () => {
  /**
   * The exact sentence that shipped for months: "the core loop described in
   * PRODUCT.md is not built yet". Every fragment of it is banned separately, so
   * a partial reintroduction fails too.
   */
  it("carries no self-negating or repository-facing copy", () => {
    for (const [name, source] of PUBLIC_SURFACES) {
      for (const banned of [
        "PRODUCT.md",
        "ARCHITECTURE.md",
        "not built yet",
        "core loop",
        "in early development",
        "For development",
        "prototype",
      ]) {
        expect(source, `${name} must not say "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("exposes none of the internal vocabulary to a stranger", () => {
    for (const [name, source] of PUBLIC_SURFACES) {
      for (const banned of [
        "PreparedChange",
        "ValidationRun",
        "OperationRun",
        "ChangeMerge",
        "Product Profile",
        "contractVersion",
        "repository intelligence",
      ]) {
        expect(source, `${name} must not expose "${banned}"`).not.toContain(banned);
      }
    }
  });

  it("promises no outcome it cannot cause", () => {
    for (const [name, source] of SELLING_SURFACES) {
      for (const banned of [
        "guarantee",
        "guaranteed",
        "automatically deploy",
        "deploys your",
        "rank #1",
        "more revenue",
        "10x",
      ]) {
        expect(source, `${name} must not claim "${banned}"`).not.toContain(banned);
      }
    }
  });

  /**
   * The positioning, in the words the page now uses (UI-19).
   *
   * "You vibe-coded the product. Now vibe the business." was the pinned pair
   * for months and is deliberately retired here: the same claim reads "You
   * built the product. Now build the business.", and *vibe-coded* is precisely
   * the developer vocabulary the sweep above bans from a stranger's first
   * screen. What is pinned is unchanged in kind — the page still leads with
   * what the visitor already has and what Vibe adds to it.
   */
  it("keeps the product positioning it was written to carry", () => {
    expect(LANDING).toContain("You built the product. Now build");
    expect(LANDING).toContain("the business.");
    expect(LANDING).toContain("From product to business, together.");
  });
});

describe("the product proof is real", () => {
  /**
   * The proof section reads the nine areas from the domain rather than listing
   * them again. That is what stops it drifting — and what stops it becoming a
   * place where a plausible-looking score can be typed in by hand.
   */
  it("takes the areas it shows from the audit's own constants", () => {
    expect(PROOF).toContain("BUSINESS_LENSES");
    expect(PROOF).toContain("LENS_LABELS");
  });

  it("invents no scores, testimonials or customer numbers", () => {
    const copy = copyOf(PROOF);
    for (const banned of ["customers say", "testimonial", "MRR", "ARR", "★", "Healthy", "At risk"]) {
      expect(copy, `proof must not contain "${banned}"`).not.toContain(banned);
    }
    // No score-shaped values either. The tiles carry an em dash on purpose:
    // there is no product connected, so there is nothing to have judged.
    // Inline styles are dropped first — a gradient stop at `50%` is a colour,
    // not a claim about anybody's business.
    const text = copy.replace(/style=\{\{[\s\S]*?\}\}/g, "");
    expect(text).not.toMatch(/\b(?:[1-9]|10)\s*\/\s*10\b/);
    expect(text).not.toMatch(/\b\d{1,3}\s*%/);
    // The same claim, in the words the preview now uses: nothing is filled in,
    // and the page says so rather than letting an empty map imply data.
    expect(copy).toContain("Scores and relationships appear only after Vibe has evidence");
  });
});

describe("the legal surfaces are honest about being drafts", () => {
  it("claims no certification Vibe does not hold", () => {
    for (const source of [PRIVACY, TERMS]) {
      for (const banned of ["SOC 2", "SOC2", "ISO 27001", "GDPR compliant", "HIPAA", "certified"]) {
        expect(source, banned).not.toContain(banned);
      }
    }
  });

  it("invents no company registration, address or officer", () => {
    for (const source of [PRIVACY, TERMS]) {
      for (const banned of ["VAT", "Registered office", "Data Protection Officer", "GmbH", "Ltd."]) {
        expect(source, banned).not.toContain(banned);
      }
    }
  });

  it("names what still has to be filled in before launch", () => {
    for (const source of [PRIVACY, TERMS]) {
      expect(source).toContain("pending={[");
      expect(source).toMatch(/registered address/);
    }
  });
});
