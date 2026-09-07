import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Root reaches exactly the callers named here, and nothing else.
 *
 * ## Why this file exists rather than a comment
 *
 * `SandboxHandle.run` is shared. Validation, preview and the agent all call it,
 * and every one of them runs commands a **customer's repository** supplies —
 * an install script, a build, a test command. Handing root to any of those is
 * the hazard [ADR 0015](../../../docs/decisions/0015-untrusted-repository-execution-provider.md)
 * exists to prevent, and it would be one word to do.
 *
 * The option is here because the browser image build genuinely needs it: it
 * installs Chromium's shared libraries with `dnf`, and a package manager needs
 * root. That build is the one sandbox in the product with **no customer code in
 * it at all** — no clone, no source, no repository-supplied command — which is
 * what makes root a property of the machine rather than a privilege handed to
 * someone else's script.
 *
 * ## What an entry has to argue
 *
 * Not that root is needed — everything wants root. What decides it is whether
 * anything in that VM comes from outside Vibe. An entry names that, or it does
 * not belong here.
 */
const PERMITTED_SUDO_CALLERS: readonly { path: string; why: string }[] = [
  {
    path: "src/modules/authenticated-product-intelligence/sandbox-browser/image-build.ts",
    why:
      "The Deep Scan browser image build (ADR 0076). `dnf install` needs root, and this " +
      "is the only sandbox in the product created with no source at all — no clone, no " +
      "customer repository, no repository-supplied command, nothing on the filesystem but " +
      "the base image and what Vibe puts there. There is no third party in this VM to hand " +
      "root to, which is the whole argument; the commands are Vibe constants with no " +
      "interpolation point anything outside this file can reach.",
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
      // Prose may discuss what code may not do, and tests may name the option
      // they assert about — including this one.
      if (/\.(test|canary|probe|concurrency|migration)\.tsx?$/.test(entry.name)) continue;
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

/** `sudo` as something a caller *sets*, not as a field a type declares. */
const SETS_SUDO = /\bsudo:\s*(true|input\.sudo|step\.sudo)/;

describe("root is scoped to the sandbox with nothing of anyone else's in it", () => {
  it("finds the sources it is supposed to be checking", () => {
    // The guard against a walk that silently matched nothing and passed.
    const all = sources();
    expect(all.length).toBeGreaterThan(300);
    expect(all.some((source) => source.path.includes("validation/sandbox-port"))).toBe(true);
  });

  it("is asked for only by the callers listed here", () => {
    const permitted = new Set(PERMITTED_SUDO_CALLERS.map((entry) => entry.path));

    const askedBy = sources()
      .filter((source) => SETS_SUDO.test(source.code))
      .map((source) => source.path)
      // The port declares the option and the adapter forwards it. Neither
      // chooses it, and both must keep being able to describe it.
      .filter(
        (path) =>
          path !== "src/modules/validation/sandbox-port.ts" &&
          path !== "src/modules/validation/vercel/provider.ts" &&
          path !== "src/modules/authenticated-product-intelligence/sandbox-browser/image.ts",
      )
      .filter((path) => !permitted.has(path));

    expect(
      askedBy,
      "A sandbox that runs a customer's own commands must never run them as root. " +
        "ADR 0015 is that repository code executes with the least the provider can give " +
        "it, and root is the opposite of that.",
    ).toEqual([]);
  });

  it("keeps every permitted entry pointing at a file that still asks", () => {
    // A stale entry is worse than a missing one: a standing permission nobody
    // is checking, pre-approving whatever is written at that path next.
    const all = new Map(sources().map((source) => [source.path, source.code]));

    for (const entry of PERMITTED_SUDO_CALLERS) {
      const code = all.get(entry.path);
      expect(code, `${entry.path} is permitted but does not exist`).toBeDefined();
      expect(code, `${entry.path} is permitted but no longer asks for root`).toMatch(SETS_SUDO);
    }
  });

  it("makes every entry name what is in the VM, not that root is needed", () => {
    for (const entry of PERMITTED_SUDO_CALLERS) {
      // Everything wants root. What decides it is whether anything in that VM
      // came from outside Vibe.
      expect(entry.why.length).toBeGreaterThan(150);
      expect(entry.why).toMatch(/ADR \d{4}/);
    }
  });

  it("never lets the phase that runs repository commands ask for it", () => {
    // Named explicitly rather than left to the sweep, because this is the file
    // where the mistake would actually be made.
    const runner = sources().find((source) => source.path.includes("validation/phases"));

    if (runner) expect(runner.code).not.toMatch(SETS_SUDO);
  });
});
