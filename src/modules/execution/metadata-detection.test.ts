import { describe, expect, it } from "vitest";
import {
  assessMetadata,
  resolveMetadataValues,
  type MetadataSource,
  type ObservedMetadata,
  type TrustedContent,
} from "./metadata-detection";

/**
 * Detector semantics (Sprint 13A.1 §21).
 *
 * The failure this suite exists to prevent is the Sprint 8 one, repeated with
 * a wider surface: `openGraph`, `title` and `description` appear in type
 * definitions, fixtures, docs, helpers and dead code, and none of those put a
 * tag on a page. A detector that counts a string in a parser produces confident
 * wrong advice that nothing downstream can catch.
 */

const VIBE_TRUSTED: TrustedContent = {
  existingTitle: "Vibe Business",
  existingDescription: "The business layer for AI-built products.",
  contextProductName: "Vibe Business",
  contextOneLiner: "The business layer for AI-built products.",
  productionOrigin: "https://vibe-business-fawn.vercel.app",
};

function observed(overrides: Partial<ObservedMetadata> = {}): ObservedMetadata {
  return {
    title: "Vibe Business",
    description: "The business layer for AI-built products.",
    openGraphKeys: [],
    unownedKeys: [],
    ...overrides,
  };
}

function staticExport(over: Partial<ObservedMetadata> = {}): MetadataSource {
  return { kind: "static_export", filePath: "src/app/layout.tsx", observed: observed(over) };
}

describe("the real Vibe Business state", () => {
  it("is ready: title and description present, Open Graph absent", () => {
    // Confirmed against both the repository and the live homepage before this
    // capability was written.
    const assessment = assessMetadata(staticExport(), VIBE_TRUSTED);

    expect(assessment.readiness).toBe("ready");
    expect(assessment.missing).toEqual(["og:title", "og:description", "og:type"]);
  });
});

describe("what does not count as metadata", () => {
  it("ignores a project with no framework-served export", () => {
    // Creating one means deciding where it lives in somebody else's layout,
    // which is a structural edit rather than filling a gap.
    expect(assessMetadata({ kind: "absent" }, VIBE_TRUSTED).readiness).toBe("unsupported");
  });

  it("refuses to edit dynamically generated metadata", () => {
    // `generateMetadata()` is a good pattern and an unreadable one for a
    // deterministic editor. Editing it blind could override values computed at
    // request time.
    const assessment = assessMetadata(
      { kind: "custom_factory", filePath: "src/app/layout.tsx" },
      VIBE_TRUSTED,
    );

    expect(assessment.readiness).toBe("unsupported");
    expect(assessment.reason).toMatch(/dynamically/i);
  });

  it("only reads the framework-served export, never other files", () => {
    // The detector's input *is* the resolved metadata source. A parser, a test
    // fixture or a doc mentioning `openGraph` cannot reach this function,
    // because the only thing it can be given is what the framework serves —
    // which is the structural version of the Sprint 8 lesson.
    const assessment = assessMetadata(staticExport({ openGraphKeys: [] }), VIBE_TRUSTED);
    expect(assessment.readiness).toBe("ready");
  });
});

describe("completeness", () => {
  it("is not applicable when the owned Open Graph fields already exist", () => {
    const assessment = assessMetadata(
      staticExport({ openGraphKeys: ["title", "description", "type"] }),
      VIBE_TRUSTED,
    );

    expect(assessment.readiness).toBe("not_applicable");
    expect(assessment.missing).toEqual([]);
  });

  it("is ready when Open Graph is only partially present", () => {
    // Fills the gap rather than rewriting what exists.
    const assessment = assessMetadata(
      staticExport({ openGraphKeys: ["title"] }),
      VIBE_TRUSTED,
    );

    expect(assessment.readiness).toBe("ready");
    expect(assessment.missing).toEqual(["og:description", "og:type"]);
  });

  it("is case-insensitive about existing Open Graph keys", () => {
    const assessment = assessMetadata(
      staticExport({ openGraphKeys: ["Title", "DESCRIPTION", "type"] }),
      VIBE_TRUSTED,
    );

    expect(assessment.readiness).toBe("not_applicable");
  });
});

describe("trusted sources only", () => {
  it("needs input when no truthful description exists anywhere", () => {
    // The alternative is writing marketing copy nobody approved, which is the
    // failure this capability is shaped to avoid.
    const assessment = assessMetadata(
      staticExport({ description: null }),
      { ...VIBE_TRUSTED, existingDescription: null, contextOneLiner: null },
    );

    expect(assessment.readiness).toBe("needs_user_input");
    expect(assessment.missing).toContain("description");
  });

  it("needs input when no truthful title exists anywhere", () => {
    const assessment = assessMetadata(
      staticExport({ title: null }),
      { ...VIBE_TRUSTED, existingTitle: null, contextProductName: null },
    );

    expect(assessment.readiness).toBe("needs_user_input");
    expect(assessment.missing).toContain("title");
  });

  it("falls back to business context only when metadata is absent", () => {
    const resolved = resolveMetadataValues({
      ...VIBE_TRUSTED,
      existingTitle: null,
      existingDescription: null,
    });

    expect(resolved).toEqual({
      ok: true,
      values: {
        title: "Vibe Business",
        description: "The business layer for AI-built products.",
        ogUrl: "https://vibe-business-fawn.vercel.app",
        siteName: "Vibe Business",
      },
    });
  });

  it("prefers existing metadata over business context", () => {
    // Existing active metadata is the customer's decision. Rewriting it to
    // something Vibe prefers would edit their product's voice under the guise
    // of a fix.
    const resolved = resolveMetadataValues({
      ...VIBE_TRUSTED,
      existingTitle: "Their Own Title",
      existingDescription: "Their own description.",
      contextProductName: "Vibe's Idea Of It",
      contextOneLiner: "Vibe's idea of the description.",
    });

    expect(resolved).toMatchObject({
      ok: true,
      values: { title: "Their Own Title", description: "Their own description." },
    });
  });

  it("omits og:url rather than guessing one", () => {
    // A guessed URL points shared links at the wrong place.
    const resolved = resolveMetadataValues({ ...VIBE_TRUSTED, productionOrigin: null });

    expect(resolved).toMatchObject({ ok: true, values: { ogUrl: null } });
  });

  it("treats whitespace-only values as absent", () => {
    const resolved = resolveMetadataValues({
      ...VIBE_TRUSTED,
      existingTitle: "   ",
      contextProductName: null,
    });

    expect(resolved).toMatchObject({ ok: false });
  });
});

describe("every assessment explains itself", () => {
  it.each([
    ["ready", staticExport(), VIBE_TRUSTED],
    ["not_applicable", staticExport({ openGraphKeys: ["title", "description", "type"] }), VIBE_TRUSTED],
    ["unsupported", { kind: "absent" } as MetadataSource, VIBE_TRUSTED],
  ])("%s carries a reason a user can act on", (_readiness, source, trusted) => {
    expect(assessMetadata(source as MetadataSource, trusted).reason.trim().length).toBeGreaterThan(0);
  });
});
