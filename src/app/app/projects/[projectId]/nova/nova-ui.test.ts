import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * What Nova Home may and may not put on a screen.
 *
 * ## Why these are source assertions
 *
 * The project has no React rendering harness, and the rules being checked are
 * about what the markup is *allowed to contain* rather than about what a tree
 * computes. `command-center-ui.test.ts` set the precedent, and its own comment
 * notes the cost: it has to strip comments to avoid matching its reasoning.
 * Same technique here.
 *
 * The behavioural half — that waiting never reads as working, that one control
 * dominates, that a price is carried before the click — is asserted over
 * values in `home-view.test.ts`, where it belongs.
 */

const NOVA_DIR = join(process.cwd(), "src/app/app/projects/[projectId]/nova");

/** Comments state what the code must not do, and would match every rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const FILES = readdirSync(NOVA_DIR)
  .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
  .filter((name) => !name.endsWith(".test.ts"))
  .map((name) => ({ name, body: stripComments(readFileSync(join(NOVA_DIR, name), "utf8")) }));

const component = (name: string) => FILES.find((file) => file.name === name)?.body ?? "";

describe("Nova Home", () => {
  it("has the components this slice is made of", () => {
    for (const name of [
      "nova-home.tsx",
      "focus-card.tsx",
      "attention-stack.tsx",
      "working-strip.tsx",
      "product-identity.tsx",
      "health-score.tsx",
    ]) {
      expect(component(name), name).not.toBe("");
    }
  });

  describe("money", () => {
    it("never states a currency", () => {
      for (const { name, body } of FILES) {
        // `USD` word-bounded and case-sensitive: `statusDot` contains "usD".
        expect(body, name).not.toMatch(/\$\d|\bUSD\b|\bdollars?\b/);
      }
    });

    it("renders a price through the one component that resolves it", () => {
      // The Focus Card takes a retail kind and hands it to `ActionBlock`,
      // which renders `CostDisclosure`. No screen formats Credits by hand.
      expect(component("focus-card.tsx")).toContain("ActionBlock");
      for (const { name, body } of FILES) {
        expect(body, name).not.toContain("Credits`");
        expect(body, name).not.toMatch(/formatCredits/);
      }
    });

    it("never hides the price behind the consequence disclosure", () => {
      // `ActionBlock` renders the cost inline and the consequence in a
      // `Disclosure`. Nova passes `operation` for the price and
      // `consequence` for the prose — never the price as the prose.
      const home = component("nova-home.tsx");
      expect(home).toContain("operation={meta.price}");
      expect(home).not.toMatch(/consequence=\{[^}]*price/);
    });
  });

  describe("progress", () => {
    it("shows no percentage, bar or step counter", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/\d+\s*%/);
        expect(body, name).not.toMatch(/progress(bar|Bar)|role="progressbar"/);
        expect(body, name).not.toMatch(/\bstep \d+ of\b/i);
      }
    });

    it("animates only while something is genuinely happening", () => {
      // The one loop on this page is the working dot, and it is behind both a
      // live check and `motion-safe`.
      const strip = component("working-strip.tsx");
      expect(strip).toContain("motion-safe:animate-pulse");
      expect(strip).toContain('const live = working.phase === "working"');

      for (const { name, body } of FILES) {
        if (name === "working-strip.tsx") continue;
        expect(body, name).not.toMatch(/animate-(pulse|spin|bounce|ping)/);
      }
    });
  });

  describe("evidence", () => {
    it("never renders a raw evidence id", () => {
      // Citations arrive already resolved; the id is dropped in the reader.
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/evidenceIds|\.evidence\[\d\]\.id\b/);
      }
    });

    it("resolves citations through the shared resolver", () => {
      expect(component("nova-home-data.ts")).toContain("describeEvidenceId");
    });

    /**
     * The bug this was written for.
     *
     * Every product-profile field is an `Attributed<T>` — `{ value,
     * confidence, sources, evidence }` — so reaching into the stored document
     * for `identity.category` hands React an object to render, and the enum
     * inside it (`developer_tool`) is a machine token no founder should read.
     * Both faults come from the same move: parsing a domain document in a
     * surface instead of asking the module that owns its words.
     */
    it("takes display values from a module's view boundary, never from a stored document", () => {
      const reader = component("nova-home-data.ts");

      expect(reader).toContain("buildHeadline");
      // No walking into a profile or audit document for something to print.
      expect(reader).not.toMatch(/result\??\.\s*identity/);
      expect(reader).not.toMatch(/\.\s*identity\s*\??\.\s*\w+\s*\??\.\s*value/);
    });

    it("puts the conclusion above the evidence, never the other way round", () => {
      const finding = readFileSync(
        join(process.cwd(), "src/components/system/finding-card.tsx"),
        "utf8",
      );
      const title = finding.indexOf("{title}");
      const citations = finding.indexOf("<CitationCount");
      expect(title).toBeGreaterThan(-1);
      expect(citations).toBeGreaterThan(title);
    });
  });

  describe("hierarchy", () => {
    it("raises exactly one surface", () => {
      // `VibeCard` is surface level 3 — "one primary object per view".
      const raised = FILES.filter((file) => /<VibeCard/.test(file.body));
      expect(raised.map((file) => file.name)).toEqual(["focus-card.tsx"]);
    });

    it("gives the attention stack no controls of its own", () => {
      const stack = component("attention-stack.tsx");
      expect(stack).not.toMatch(/<Button|<form|ActionBlock|CostDisclosure/);
    });

    it("is a column rather than a dashboard grid", () => {
      expect(component("nova-home.tsx")).toContain("flex flex-col");
      expect(component("nova-home.tsx")).not.toMatch(/grid-cols-[2-9]/);
    });

    it("has no chat input anywhere", () => {
      for (const { name, body } of FILES) {
        expect(body, name).not.toMatch(/<textarea|type="text"|placeholder=/);
      }
    });
  });

  describe("honest absence", () => {
    it("renders a missing score through the one function that knows n/a", () => {
      const health = component("health-score.tsx");
      expect(health).toContain("scoreDisplay");
      // Never a zero standing in for "nothing was measurable".
      expect(health).not.toMatch(/score\s*\?\?\s*0|score\s*\|\|\s*0/);
    });

    it("keeps a never-audited project distinct from an unscored one", () => {
      expect(component("health-score.tsx")).toContain("HealthScoreAbsent");
      expect(component("nova-home.tsx")).toContain("HealthScoreAbsent");
    });

    it("offers no control when there is nothing to do", () => {
      // `control` is optional on the card and omitted for the settled case.
      expect(component("nova-home.tsx")).toContain('control.kind === "none"');
    });
  });

  describe("status", () => {
    it("takes every word from the shared vocabulary", () => {
      for (const name of ["working-strip.tsx", "attention-stack.tsx", "focus-card.tsx"]) {
        expect(component(name), name).toMatch(/statusFor(OperationPhase|FocusTier)/);
      }
    });

    it("never depends on colour alone", () => {
      // Every tone in this slice is rendered by a component that also prints
      // the word: `StatusPill` takes children, `StatusDot` is aria-hidden and
      // is always paired with one here.
      const strip = component("working-strip.tsx");
      expect(strip).toContain("status.word");
      expect(component("attention-stack.tsx")).toContain("status.word");
    });
  });
});
