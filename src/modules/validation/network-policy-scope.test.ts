import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `allow_all` reaches exactly the callers named here, and nothing else
 * (ADR 0076, CLAUDE.md rule 64).
 *
 * ## Why this file exists rather than a comment
 *
 * `SandboxNetworkPolicy` is shared. Validation, preview and the agent all
 * construct one, and until now the type itself was the boundary: the strictest
 * thing available was `deny_all` and the loosest was a list somebody had to
 * write down. Adding an unrestricted mode removes that property — from here on
 * the strictest policy and the weakest are one keystroke apart, in a union
 * every sandbox caller imports.
 *
 * A comment saying "only the browser may use this" is a comment. This is the
 * same sentence in a form that fails a build, and it is modelled on
 * `economy/sprint-0054-safety.test.ts`, which guards a different boundary the
 * same way and for the same reason.
 *
 * ## What each entry has to argue
 *
 * Not "this is convenient" and not "this is safe" — that is the conclusion, not
 * the evidence. An entry names **what is in the sandbox**, because that is what
 * decides whether unrestricted egress is a hazard: egress matters when there is
 * something to exfiltrate and somewhere untrusted to send it from.
 *
 * Adding an entry here is a decision with an ADR behind it, not a way to make
 * a failing test pass.
 */
const PERMITTED_ALLOW_ALL_CALLERS: readonly { path: string; why: string }[] = [
  {
    path: "src/modules/authenticated-product-intelligence/sandbox-browser/provider.ts",
    why:
      "The Deep Scan browser. Its destinations cannot be enumerated in advance — an " +
      "identity provider, a CDN, a bot-check, whatever a customer's login form posts to — " +
      "and an allowlist that must contain all of them is a list somebody maintains until " +
      "the day a customer cannot sign in. What makes it acceptable is the contents: no " +
      "customer repository, no Vibe credential, no database, no source. Only Chromium and " +
      "a guard Vibe wrote, so there is nothing there to exfiltrate. ADR 0076.",
  },
];

const SOURCE_ROOT = join(process.cwd(), "src");

/** Every non-test TypeScript source under `src/`, with comments stripped. */
function sources(): { path: string; code: string }[] {
  const found: { path: string; code: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      // Prose may discuss what code may not do, and tests may name the mode
      // they assert about — including this one.
      if (/\.(test|canary|probe|concurrency)\.tsx?$/.test(entry.name)) continue;
      found.push({
        path: full.slice(process.cwd().length + 1),
        code: readFileSync(full, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/\/\/.*$/gm, ""),
      });
    }
  };

  walk(SOURCE_ROOT);
  return found;
}

describe("unrestricted egress is scoped to its one caller", () => {
  it("finds the sources it is supposed to be checking", () => {
    // The guard against a walk that silently matched nothing and passed.
    const all = sources();
    expect(all.length).toBeGreaterThan(300);
    expect(all.some((source) => source.path.includes("validation/sandbox-port"))).toBe(true);
  });

  it("is named only by the callers listed here", () => {
    const permitted = new Set(PERMITTED_ALLOW_ALL_CALLERS.map((entry) => entry.path));

    const namedBy = sources()
      .filter((source) => source.code.includes("allow_all"))
      .map((source) => source.path)
      // The union's own definition and the adapter that translates it are where
      // the mode is declared, not where it is chosen.
      .filter(
        (path) =>
          path !== "src/modules/validation/sandbox-port.ts" &&
          path !== "src/modules/validation/vercel/provider.ts",
      )
      .filter((path) => !permitted.has(path));

    expect(
      namedBy,
      "A sandbox that runs customer code must never reach this mode. Rule 64 is the " +
        "most restrictive policy the provider supports, and for anything repository-" +
        "controlled that is still deny_all before the first command.",
    ).toEqual([]);
  });

  it("keeps every permitted entry pointing at a file that exists and uses it", () => {
    // A stale entry is worse than a missing one: it is a standing permission
    // nobody is checking, pre-approving whatever is written at that path next.
    const all = new Map(sources().map((source) => [source.path, source.code]));

    for (const entry of PERMITTED_ALLOW_ALL_CALLERS) {
      const code = all.get(entry.path);
      expect(code, `${entry.path} is permitted but does not exist`).toBeDefined();
      expect(code, `${entry.path} is permitted but no longer names allow_all`).toContain(
        "allow_all",
      );
    }
  });

  it("makes every entry say what is in the sandbox, not that it is safe", () => {
    for (const entry of PERMITTED_ALLOW_ALL_CALLERS) {
      // "Safe" is the conclusion. The evidence is the contents, because egress
      // matters exactly when there is something to send.
      expect(entry.why.length).toBeGreaterThan(120);
      expect(entry.why).toMatch(/ADR \d{4}/);
    }
  });
});

describe("the sandboxes that run customer code keep their policies", () => {
  it("leaves validation and preview naming only the two bounded modes", () => {
    const repositoryExecuting = sources().filter(
      (source) =>
        source.path.startsWith("src/modules/validation/") ||
        source.path.startsWith("src/modules/change-preview/") ||
        source.path.startsWith("src/modules/coding-agent/"),
    );

    const offenders = repositoryExecuting
      .filter((source) => source.code.includes("allow_all"))
      .map((source) => source.path)
      .filter(
        (path) =>
          path !== "src/modules/validation/sandbox-port.ts" &&
          path !== "src/modules/validation/vercel/provider.ts",
      );

    expect(offenders).toEqual([]);
  });
});
