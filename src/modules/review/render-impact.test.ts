import { describe, expect, it } from "vitest";
import ts from "typescript";
import { analyzeRenderImpact, isRenderImpactCandidate } from "./render-impact";

/**
 * Render-impact analysis.
 *
 * The property under test is one-directional: a `no_render_impact` verdict must
 * mean the non-metadata program text is byte-identical, and *everything else*
 * must resolve to `unproven`. So every fixture that proves the downgrade works
 * is paired with one that proves it does not fire — a test suite that only
 * showed metadata edits passing would also pass on a function that returned
 * `no_render_impact` unconditionally.
 *
 * Fixtures are whole files written out by hand, close to this repository's own
 * `src/app/layout.tsx`, rather than assembled by a helper. The behaviour under
 * test is byte-level; a helper that built the fixtures would hide the artifact
 * being measured.
 */

const LAYOUT = "src/app/layout.tsx";

/** The shape of the real file, before the run that exposed the defect. */
const BASE_LAYOUT = `import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAppUrl } from "@/lib/env/app-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-app text-fg-body h-full font-sans">{children}</body>
    </html>
  );
}
`;

/** The same file after the run: robots directives added, nothing else. */
const HEAD_LAYOUT_METADATA_ONLY = `import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getAppUrl } from "@/lib/env/app-url";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(getAppUrl()),
  title: "Vibe Business",
  description: "The business layer for AI-built products.",
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="bg-app text-fg-body h-full font-sans">{children}</body>
    </html>
  );
}
`;

describe("the verified regression", () => {
  /**
   * Production run `5ea8a9a0` (2026-08-20). Two layouts changed, both metadata
   * only, and the classifier recommended a before/after screenshot — two
   * identical images of a page that did not move.
   */
  it("proves a metadata-only edit cannot change rendered output", () => {
    const verdict = analyzeRenderImpact({
      path: LAYOUT,
      baseText: BASE_LAYOUT,
      headText: HEAD_LAYOUT_METADATA_ONLY,
    });

    expect(verdict).toEqual({ kind: "no_render_impact", strippedExports: ["metadata"] });
  });

  it("does not fire when the same edit also touches the JSX", () => {
    const head = HEAD_LAYOUT_METADATA_ONLY.replace('lang="en"', 'lang="de"');

    expect(analyzeRenderImpact({ path: LAYOUT, baseText: BASE_LAYOUT, headText: head })).toEqual({
      kind: "unproven",
      reason: "render_path_changed",
    });
  });
});

describe("the shapes real SEO work takes", () => {
  it("proves an added metadata export, absorbing the blank line that separates it", () => {
    const base = `import type { ReactNode } from "react";

export default function Page({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
`;
    const head = `import type { ReactNode } from "react";

export const metadata = { title: "Pricing" };

export default function Page({ children }: { children: ReactNode }) {
  return <main>{children}</main>;
}
`;

    expect(analyzeRenderImpact({ path: "src/app/pricing/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "no_render_impact", strippedExports: ["metadata"] });
  });

  it("proves a removed metadata export", () => {
    expect(
      analyzeRenderImpact({
        path: LAYOUT,
        baseText: HEAD_LAYOUT_METADATA_ONLY,
        headText: BASE_LAYOUT,
      }),
    ).toEqual({ kind: "no_render_impact", strippedExports: ["metadata"] });
  });

  it("proves a changed generateMetadata function body", () => {
    const base = `export async function generateMetadata() {
  return { title: "Old" };
}

export default function Page() {
  return <main />;
}
`;
    const head = `export async function generateMetadata() {
  const title = await Promise.resolve("New");
  return { title };
}

export default function Page() {
  return <main />;
}
`;

    expect(analyzeRenderImpact({ path: "src/app/x/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "no_render_impact", strippedExports: ["generateMetadata"] });
  });

  /**
   * The one edge the whole-file `.trim()` exists for: a stripped last statement
   * leaves the file's trailing newline behind, so the two remainders differ by
   * exactly that character and nothing else.
   */
  it("proves a change to metadata declared last in the file", () => {
    const base = `export default function Page() {
  return <main />;
}

export const metadata = { title: "Before" };
`;
    const head = `export default function Page() {
  return <main />;
}

export const metadata = { title: "After" };`;

    expect(analyzeRenderImpact({ path: "src/app/x/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "no_render_impact", strippedExports: ["metadata"] });
  });

  it("proves a route segment config change", () => {
    const base = `export const revalidate = 60;

export default function Page() {
  return <main />;
}
`;
    const head = base.replace("60", "3600");

    expect(analyzeRenderImpact({ path: "src/app/x/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "no_render_impact", strippedExports: ["revalidate"] });
  });
});

describe("what must never be downgraded", () => {
  /**
   * The collision guard, and the reason the path check is not decoration.
   * Outside a route segment `metadata` is an ordinary constant that could
   * perfectly well feed the JSX in the same file.
   */
  it("refuses the identical edit in a component, where metadata is just a const", () => {
    const base = `export const metadata = { title: "Vibe" };

export function Header() {
  return <h1>{metadata.title}</h1>;
}
`;
    const head = base.replace('"Vibe"', '"Vibe Business"');

    expect(
      analyzeRenderImpact({ path: "src/components/header.tsx", baseText: base, headText: head }),
    ).toEqual({ kind: "unproven", reason: "not_a_route_segment" });
  });

  it("refuses a page under an API route", () => {
    expect(isRenderImpactCandidate("src/app/api/x/page.tsx")).toBe(false);
  });

  it("accepts both repository layouts", () => {
    expect(isRenderImpactCandidate("src/app/layout.tsx")).toBe(true);
    expect(isRenderImpactCandidate("app/layout.tsx")).toBe(true);
    expect(isRenderImpactCandidate("src/app/pricing/page.tsx")).toBe(true);
  });

  it("refuses anything that is not a page or layout", () => {
    expect(isRenderImpactCandidate("src/app/robots.ts")).toBe(false);
    expect(isRenderImpactCandidate("src/app/globals.css")).toBe(false);
    expect(isRenderImpactCandidate("src/app/x/template.tsx")).toBe(false);
  });

  /**
   * `generateStaticParams` decides which URLs exist, so changing it can turn a
   * page into a 404 — very much a different screenshot. It looks like it
   * belongs with the other config exports and it deliberately does not.
   */
  it("refuses a generateStaticParams change", () => {
    const base = `export function generateStaticParams() {
  return [{ slug: "a" }];
}

export default function Page() {
  return <main />;
}
`;
    const head = base.replace('"a"', '"b"');

    expect(analyzeRenderImpact({ path: "src/app/[slug]/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "unproven", reason: "render_path_changed" });
  });

  it("refuses a changed exported constant that is not in the set", () => {
    const base = `export const HERO_COPY = "Ship faster";

export default function Page() {
  return <h1>{HERO_COPY}</h1>;
}
`;
    const head = base.replace("Ship faster", "Ship it now");

    expect(analyzeRenderImpact({ path: "src/app/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "unproven", reason: "render_path_changed" });
  });

  /** One declaration list, one safe name and one unsafe. Neither is stripped. */
  it("refuses a mixed declaration list", () => {
    const base = `export const metadata = { title: "T" }, HERO = "Ship faster";

export default function Page() {
  return <h1>{HERO}</h1>;
}
`;
    const head = base.replace("Ship faster", "Ship it now");

    expect(analyzeRenderImpact({ path: "src/app/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "unproven", reason: "render_path_changed" });
  });

  it("refuses a metadata object declared inside a function", () => {
    const base = `export default function Page() {
  const metadata = { title: "T" };
  return <h1>{metadata.title}</h1>;
}
`;
    const head = base.replace('"T"', '"U"');

    expect(analyzeRenderImpact({ path: "src/app/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "unproven", reason: "render_path_changed" });
  });

  /**
   * The upper bound of the normalization, pinned deliberately. Someone will
   * eventually want to "improve" this by ignoring blank lines or trimming every
   * line — both would erase real changes, because a blank line inside a
   * template literal renders and JSX text nodes are whitespace-sensitive. A
   * reindented render path must stay unproven.
   */
  it("refuses a metadata edit that also reindents the JSX", () => {
    const head = HEAD_LAYOUT_METADATA_ONLY.replace(
      "    <html lang=\"en\" className=\"h-full antialiased\">",
      "      <html lang=\"en\" className=\"h-full antialiased\">",
    );

    expect(analyzeRenderImpact({ path: LAYOUT, baseText: BASE_LAYOUT, headText: head })).toEqual({
      kind: "unproven",
      reason: "render_path_changed",
    });
  });

  it("refuses when nothing in the stripped set is present at all", () => {
    const base = `export default function Page() {
  return <main>a</main>;
}
`;
    const head = base.replace(">a<", ">b<");

    expect(analyzeRenderImpact({ path: "src/app/page.tsx", baseText: base, headText: head }))
      .toEqual({ kind: "unproven", reason: "render_path_changed" });
  });
});

describe("every failure resolves to unproven", () => {
  it("treats a missing base version as a new, visible page", () => {
    expect(
      analyzeRenderImpact({ path: LAYOUT, baseText: null, headText: HEAD_LAYOUT_METADATA_ONLY }),
    ).toEqual({ kind: "unproven", reason: "no_base_version" });
  });

  it("treats an unreadable head version as unavailable", () => {
    expect(analyzeRenderImpact({ path: LAYOUT, baseText: BASE_LAYOUT, headText: null })).toEqual({
      kind: "unproven",
      reason: "content_unavailable",
    });
  });

  it("treats an oversized file as unavailable rather than parsing it", () => {
    const huge = `${BASE_LAYOUT}\n// ${"x".repeat(64 * 1024)}`;

    expect(analyzeRenderImpact({ path: LAYOUT, baseText: BASE_LAYOUT, headText: huge })).toEqual({
      kind: "unproven",
      reason: "content_unavailable",
    });
  });

  it("treats a file that does not parse as unproven", () => {
    const broken = `export const metadata = { title: "T" };

export default function Page() {
  return <main>
}
`;

    expect(analyzeRenderImpact({ path: LAYOUT, baseText: BASE_LAYOUT, headText: broken })).toEqual({
      kind: "unproven",
      reason: "unparseable",
    });
  });

  /**
   * `parseDiagnostics` is internal to TypeScript and absent from the public
   * `SourceFile` type. `analyzeRenderImpact` reads it defensively and treats
   * *absence* as failure, so a TypeScript upgrade that removed it would
   * silently downgrade the feature to "always visual" rather than break.
   *
   * This asserts the field is really there, so that upgrade fails loudly here
   * instead of quietly disabling the analysis everywhere.
   */
  it("can still ask TypeScript whether a file parsed", () => {
    const source = ts.createSourceFile(
      "broken.tsx",
      "export default function Page() { return <main> }",
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX,
    );

    const diagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
      .parseDiagnostics;

    expect(Array.isArray(diagnostics)).toBe(true);
    expect(diagnostics!.length).toBeGreaterThan(0);
  });
});

describe("line endings", () => {
  it("ignores a CRLF/LF difference, which no browser can render", () => {
    expect(
      analyzeRenderImpact({
        path: LAYOUT,
        baseText: BASE_LAYOUT.replace(/\n/g, "\r\n"),
        headText: HEAD_LAYOUT_METADATA_ONLY,
      }),
    ).toEqual({ kind: "no_render_impact", strippedExports: ["metadata"] });
  });
});
