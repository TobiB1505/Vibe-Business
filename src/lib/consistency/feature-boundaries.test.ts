import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The layering [ADR 0109](docs/decisions/0109-nova-first-application-shell.md)
 * decided, held as a build failure rather than a convention (CLAUDE.md rule 86).
 *
 * ## The rule
 *
 * Imports flow downward and only downward:
 *
 *     app  →  features  →  modules
 *                          components, lib   (beside modules; import nothing above)
 *
 * `src/app` is routing and composition. `src/features` is the product surface.
 * `src/modules` is the domain. `src/components` and `src/lib` are primitives
 * and cross-cutting code with no product knowledge. A file in a lower layer
 * that imports from a higher one has made the higher layer's file layout part
 * of the lower layer's contract, which is exactly what made "put the Agent's
 * view beside the thread" a route-tree surgery rather than an import.
 *
 * ## Why there is an allowlist, and what it is
 *
 * The rule was a sentence in two docblocks for a year, and it was already false
 * in three places nobody had counted. So this file does what `REVIEWED_SITES`
 * does for the service-role client: every crossing that exists today is
 * written down with the slice that retires it, the test fails when a *new*
 * crossing appears, and it also fails when a recorded crossing has quietly
 * gone — a register that can rot is a register nobody reads.
 *
 * The list is meant to shrink. Slice 1 takes the product surfaces out of
 * `src/components` — the nine Nova blocks, the landing page, the three domain
 * views — and moves `palette.ts` below both layers, which empties the
 * `components` section for good; Slice 2 takes the Agent, Plan, Health and
 * product surfaces out of the route tree and empties the `modules` section;
 * Slice 3 gives every feature a `commands.ts` and empties the rest. Adding to
 * this list is a decision, not a convenience, and the entry says which slice
 * removes it.
 *
 * ## One thing the register may never legalize
 *
 * An import **into** `src/features` from below it. That is not a crossing on
 * its way out, it is the layering inverted, and one exception would make the
 * rest decorative — a component that may compose a feature is a component with
 * product knowledge, which is the thing the split exists to prevent. It is
 * asserted unconditionally, and an entry that tried to allow it fails too.
 *
 * Which makes the real question *what a component is*, and that is a judgement
 * this file can only half enforce. It can prove no component imports a feature
 * or a route. It cannot prove a component is a primitive — `blocks/audit.tsx`
 * would pass every mechanical check the day its import moved. The
 * classification lives in ADR 0109 §2 and the audit's §C.2: a component
 * renders a shape, may take a module's types and label tables, and may never
 * compose a product surface, bind a Server Action or know a route.
 *
 * ## What is checked, and what is not
 *
 * Every non-test `.ts`/`.tsx` file under the five layers, every `import` and
 * `export … from` specifier that resolves inside `src/` — through the `@/`
 * alias or a relative path. A `type`-only import is still a crossing: it makes
 * the domain depend on where a component keeps its props, and two of the
 * recorded ones are exactly that. Not checked: `next/`, third-party packages,
 * `server-only`, CSS, and the route tree's own internal imports (a page may
 * import its sibling — the rule is about layers, not files).
 */

const SRC = join(process.cwd(), "src");

type Layer = "app" | "features" | "modules" | "components" | "lib";

const LAYERS: readonly Layer[] = ["app", "features", "modules", "components", "lib"];

/**
 * What each layer may import. `app` may import everything, so it has no row
 * and is never a violation; it is the top.
 */
const MAY_IMPORT: Record<Exclude<Layer, "app">, readonly Layer[]> = {
  features: ["features", "modules", "components", "lib"],
  modules: ["modules", "lib"],
  components: ["components", "lib", "modules"],
  lib: ["lib", "modules"],
};

/**
 * The register. One entry per importing file; `allowed` is the set of target
 * prefixes (relative to `src/`, forward slashes) that file may still reach
 * upward; `retiredBy` names the slice of the restructure audit that removes
 * the entry. Every entry must still have at least one upward import, or the
 * test fails and the entry is deleted.
 */
const TRANSITIONAL_CROSSINGS: readonly {
  file: string;
  allowed: readonly string[];
  retiredBy: string;
  reason: string;
}[] = [
  /* ── components → app ─────────────────────────────────────────────────── */
  {
    file: "components/nova/blocks/workspace.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy:
      "Slice 1 — the block moves to features/nova/thread/blocks; the crossing travels with it and Slice 2 closes it",
    reason: "Blocks compose shipped screens (Sprint 0162); the screen lives in the route tree.",
  },
  {
    file: "components/nova/blocks/review.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy:
      "Slice 1 — the block moves to features/nova/thread/blocks; Slice 2 closes the crossing",
    reason: "Same.",
  },
  {
    file: "components/nova/blocks/agent.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy:
      "Slice 1 — the block moves to features/nova/thread/blocks; Slice 2 closes the crossing",
    reason: "Same.",
  },
  {
    file: "components/nova/blocks/move.tsx",
    allowed: ["app/app/projects/[projectId]/plan/"],
    retiredBy:
      "Slice 1 — the block moves to features/nova/thread/blocks; Slice 2 closes the crossing",
    reason: "Same, for the Move card.",
  },
  {
    file: "components/nova/blocks/audit.tsx",
    allowed: ["app/app/projects/[projectId]/business-brain/"],
    retiredBy:
      "Slice 1 — the block moves to features/nova/thread/blocks; Slice 2 closes the crossing",
    reason: "Same, for the business map.",
  },
  {
    file: "components/marketing/landing-agent.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy:
      "Slice 1 — the landing page moves to features/marketing; Slice 2 closes the crossing",
    reason: "The landing page shows the real Agent components rather than a drawing of them.",
  },
  {
    file: "components/marketing/landing-business-map.tsx",
    allowed: ["app/app/projects/[projectId]/business-brain/"],
    retiredBy:
      "Slice 1 — the landing page moves to features/marketing; Slice 2 closes the crossing",
    reason: "Same, for the business map.",
  },
  {
    file: "components/product-scan/product-scan-experience.tsx",
    allowed: [
      "app/app/projects/[projectId]/understanding-actions",
      "app/app/projects/[projectId]/product-scan-status-action",
    ],
    retiredBy:
      "Slice 1 — the scan experience moves to features/product; Slice 3 gives it the feature's commands.ts",
    reason: "A shared component that binds two Server Actions living in the route tree.",
  },
  {
    file: "components/layout/app-frame.tsx",
    allowed: ["app/palette"],
    retiredBy: "Slice 1 — palette.ts moves to src/lib, below both layers",
    reason: "The palette switch is a module under src/app that is not a route.",
  },
  {
    file: "components/layout/account-card.tsx",
    allowed: ["app/palette"],
    retiredBy: "Slice 1 — palette.ts moves to src/lib, below both layers",
    reason: "Same.",
  },
  {
    file: "components/layout/mobile-account.tsx",
    allowed: ["app/palette"],
    retiredBy: "Slice 1 — palette.ts moves to src/lib, below both layers",
    reason: "Same.",
  },
  {
    file: "components/layout/palette-switch.tsx",
    allowed: ["app/palette"],
    retiredBy: "Slice 1 — palette.ts moves to src/lib, below both layers",
    reason: "Same.",
  },
  /* ── modules → app (type-only) ─────────────────────────────────────────── */
  {
    file: "modules/coding-agent/change-stage-view.ts",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy: "Slice 2 — ValidationCheck and MergeSummary move into src/modules/coding-agent",
    reason: "Type-only: the view builder returns the shapes the Agent components declare.",
  },
  {
    file: "modules/coding-agent/agent-workspace.ts",
    allowed: ["app/app/projects/[projectId]/agent/", "components/system/cost-line"],
    retiredBy:
      "Slice 2 — AgentTask, ValidationCheck, PreviewChange, MergeSummary and ChangeCost move into the module",
    reason: "Type-only, same; plus the cost line's shape.",
  },
  /* ── modules → components ──────────────────────────────────────────────── */
  {
    file: "modules/coding-agent/ui/agent-execution-live-view.tsx",
    allowed: ["components/ui/"],
    retiredBy:
      "Slice 2 — a component inside a module moves to src/features/agent, or is deleted if nothing mounts it",
    reason:
      "A screen that was built beside its read model before there was a surface layer to hold it.",
  },
  {
    file: "modules/execution/change-history-view.ts",
    allowed: ["components/ui/status-pill"],
    retiredBy: "Slice 3 — the tone vocabulary moves to src/lib, below both layers",
    reason: "Type-only: a view builder names a tone a primitive defines.",
  },
  {
    file: "modules/projects/business-brain-view.ts",
    allowed: ["components/ui/score-display"],
    retiredBy: "Slice 3 — scoreDisplay and ScoreTone move to src/lib, below both layers",
    reason: "The business reading formats its score with the primitive's own formatter.",
  },
  /* ── features → app ────────────────────────────────────────────────────── */
  {
    file: "features/nova/home/nova-agent-stage.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy: "Slice 2 — the Agent surface moves to src/features/agent",
    reason: "Nova streams the Agent's own build stage.",
  },
  {
    file: "features/nova/home/nova-ready-stage.tsx",
    allowed: ["app/app/projects/[projectId]/agent/"],
    retiredBy: "Slice 2 — the Agent surface moves to src/features/agent",
    reason: "Nova offers the Agent's own start controls.",
  },
  {
    file: "features/nova/home/nova-home.tsx",
    allowed: [
      "app/app/projects/[projectId]/agent/agent-workspace-choice-action",
      "app/app/projects/[projectId]/founder-input-action",
    ],
    retiredBy: "Slices 2 and 3 — the Agent surface and the feature commands",
    reason: "One Agent action wrapper and one Server Action the thread binds.",
  },
  {
    file: "features/nova/home/nova-home-actions.ts",
    allowed: [
      "app/app/projects/[projectId]/outcome-actions",
      "app/app/projects/[projectId]/run-audit-action",
      "app/app/projects/[projectId]/plan-action",
      "app/app/projects/[projectId]/understanding-actions",
      "app/app/projects/[projectId]/validate-change-action",
    ],
    retiredBy: "Slice 3 — every feature exposes commands.ts and the actions leave the route tree",
    reason: "The dispatch calls five Server Actions that still live beside the routes.",
  },
  {
    file: "features/nova/home/nova-header-live.tsx",
    allowed: ["app/app/projects/[projectId]/run-audit-action"],
    retiredBy: "Slice 3 — every feature exposes commands.ts",
    reason: "The status poll reads through the operation-status action.",
  },
  {
    file: "features/nova/home/nova-opening-screen.tsx",
    allowed: ["app/app/onboarding/[projectId]/actions"],
    retiredBy: "Slice 3 — the onboarding feature's commands.ts",
    reason: "The introduction writes its milestone through the onboarding actions.",
  },
  {
    file: "features/nova/bindings/nova-actions.ts",
    allowed: [
      "app/app/onboarding/[projectId]/actions",
      "app/app/projects/[projectId]/agent/interrupt-actions",
      "app/app/projects/[projectId]/agent/workspace-actions",
      "app/app/projects/[projectId]/agent/agent-run-actions",
      "app/app/projects/[projectId]/founder-input-action",
      "app/app/projects/[projectId]/merge-actions",
      "app/app/projects/[projectId]/outcome-actions",
      "app/app/projects/[projectId]/plan-action",
      "app/app/projects/[projectId]/run-audit-action",
      "app/app/projects/[projectId]/understanding-actions",
      "app/app/projects/[projectId]/validate-change-action",
    ],
    retiredBy: "Slice 3 — the binding imports each feature's commands.ts instead",
    reason:
      "The catalogue's binding table names every Server Action it binds, and the compiler proves each exists.",
  },
];

/* ── mechanics ───────────────────────────────────────────────────────────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** `src/`-relative with forward slashes, whatever the platform separator. */
function rel(path: string): string {
  return relative(SRC, path).split(sep).join("/");
}

function layerOf(relPath: string): Layer | null {
  const head = relPath.split("/")[0];
  return (LAYERS as readonly string[]).includes(head ?? "") ? (head as Layer) : null;
}

/**
 * Every module specifier this file imports or re-exports, resolved to a
 * `src/`-relative path — or dropped when it does not point inside `src/`.
 */
function importsOf(path: string, source: string): string[] {
  const specifiers = [
    ...source.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s+["']([^"']+)["']/gm),
    ...source.matchAll(/^\s*import\s+["']([^"']+)["']/gm),
  ].map((match) => match[1]!);

  return specifiers.flatMap((specifier) => {
    if (specifier.startsWith("@/")) return [specifier.slice(2)];
    if (specifier.startsWith(".")) return [rel(resolve(dirname(path), specifier))];
    return [];
  });
}

type Crossing = { file: string; target: string; from: Layer; to: Layer };

/** Every import that goes to a layer the importing layer may not reach. */
function upwardCrossings(): Crossing[] {
  const crossings: Crossing[] = [];

  for (const path of sourceFiles(SRC)) {
    const file = rel(path);
    const from = layerOf(file);
    if (from === null || from === "app") continue;

    const source = readFileSync(path, "utf8");
    for (const target of importsOf(path, source)) {
      const to = layerOf(target);
      if (to === null) continue;
      if (MAY_IMPORT[from].includes(to)) continue;
      crossings.push({ file, target, from, to });
    }
  }

  return crossings;
}

const CROSSINGS = upwardCrossings();
const REGISTER = new Map(TRANSITIONAL_CROSSINGS.map((entry) => [entry.file, entry]));

describe("the layering holds: app → features → modules", () => {
  it("finds the files it is supposed to be checking", () => {
    // A walk that found nothing would pass every assertion below while
    // checking none of them.
    const files = sourceFiles(SRC).map(rel);
    for (const layer of LAYERS) {
      expect(
        files.some((file) => file.startsWith(`${layer}/`)),
        layer,
      ).toBe(true);
    }
    expect(CROSSINGS.length).toBeGreaterThan(0);
  });

  it("permits an upward import only where the register names it", () => {
    const unregistered = CROSSINGS.filter((crossing) => {
      const entry = REGISTER.get(crossing.file);
      return !entry || !entry.allowed.some((prefix) => crossing.target.startsWith(prefix));
    });

    expect(
      unregistered.map((c) => `${c.file} → ${c.target} (${c.from} → ${c.to})`),
      "A file imports from a layer above it and TRANSITIONAL_CROSSINGS does not name " +
        "the pair. Import downward instead — a feature's commands.ts or queries.ts, a " +
        "module's view builder, a component — or, if this genuinely has to wait for a " +
        "slice, add an entry that says which one (ADR 0109, rule 86).",
    ).toEqual([]);
  });

  it("keeps no entry for a crossing that no longer exists", () => {
    const stale = TRANSITIONAL_CROSSINGS.filter(
      (entry) =>
        !CROSSINGS.some(
          (crossing) =>
            crossing.file === entry.file &&
            entry.allowed.some((prefix) => crossing.target.startsWith(prefix)),
        ),
    );

    expect(
      stale.map((entry) => entry.file),
      "These register entries no longer match an upward import. The crossing was " +
        "retired — delete the entry so the register keeps describing the code.",
    ).toEqual([]);
  });

  it("names a retiring slice on every entry", () => {
    for (const entry of TRANSITIONAL_CROSSINGS) {
      expect(entry.retiredBy, entry.file).toMatch(/^Slice/);
      expect(entry.reason.length, entry.file).toBeGreaterThan(0);
    }
  });

  it("lets nothing below the features import from them", () => {
    // Features are the top of the product; a component or a module that
    // imported one would have product knowledge it is not allowed to have.
    // Unconditional: the register is not consulted, because this is not a
    // crossing being retired — it is the layering inverted (ADR 0109 §2).
    const into = CROSSINGS.filter((crossing) => crossing.to === "features");
    expect(
      into.map((c) => `${c.file} → ${c.target}`),
      "A file below the feature layer imports a feature. Move the file into " +
        "the feature instead: a component that composes a product surface is " +
        "a feature wearing a component's address (rule 86).",
    ).toEqual([]);
  });

  it("refuses a register entry that would allow one", () => {
    // Belt and braces: the assertion above catches the import, and this
    // catches the attempt to write down permission for it.
    const legalizing = TRANSITIONAL_CROSSINGS.filter((entry) =>
      entry.allowed.some((prefix) => prefix.startsWith("features/")),
    );
    expect(
      legalizing.map((entry) => entry.file),
      "TRANSITIONAL_CROSSINGS may never name a target inside src/features. " +
        "The register is for crossings on their way out; this one has no way out.",
    ).toEqual([]);
  });

  it("lets lib import from nothing above it", () => {
    const fromLib = CROSSINGS.filter((crossing) => crossing.from === "lib");
    expect(fromLib.map((c) => `${c.file} → ${c.target}`)).toEqual([]);
  });

  it("keeps the module crossings into the route tree type-only", () => {
    // A runtime import from the domain into a route file would pull a page's
    // dependency graph into the module; a type import only borrows a shape,
    // which is bad enough to be registered and not bad enough to be a bug.
    for (const crossing of CROSSINGS.filter((c) => c.from === "modules" && c.to === "app")) {
      const source = readFileSync(join(SRC, crossing.file), "utf8");
      const lines = source
        .split("\n")
        .filter(
          (line) => line.includes(`"@/${crossing.target}"`) || line.includes(crossing.target),
        );
      const runtime = lines.filter(
        (line) => /^\s*import\b/.test(line) && !/^\s*import\s+type\b/.test(line),
      );
      expect(runtime, `${crossing.file} → ${crossing.target}`).toEqual([]);
    }
  });
});

describe("the Nova surface has left the route tree (ADR 0109, Slice 0)", () => {
  const ROUTE = join(SRC, "app", "app", "projects", "[projectId]");

  it("keeps no Nova file under the project route", () => {
    const named = sourceFiles(ROUTE)
      .map(rel)
      .filter((file) => /(^|\/)nova[^/]*$/.test(file));
    expect(named).toEqual([]);
  });

  it("composes the index from the feature", () => {
    const page = readFileSync(join(ROUTE, "page.tsx"), "utf8");
    expect(page).toContain('from "@/features/nova/home/nova-home"');
    expect(page).toContain('from "@/features/nova/home/nova-opening-screen"');
    expect(page).not.toMatch(/from "\.\/nova/);
  });

  it("holds the Nova feature's own files", () => {
    for (const file of [
      "features/nova/home/nova-home.tsx",
      "features/nova/home/nova-home-data.ts",
      "features/nova/bindings/nova-actions.ts",
      "features/nova/voice/nova-audit-voice.tsx",
    ]) {
      expect(statSync(join(SRC, file)).isFile(), file).toBe(true);
    }
  });
});
