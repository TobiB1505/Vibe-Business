import { describe, expect, it } from "vitest";
import { PREVIEW_BUDGETS } from "./budgets";
import {
  PREVIEWABLE_FRAMEWORKS,
  previewProfileForFrameworks,
  previewServerCommandFor,
  previewServerEnvironmentFor,
} from "./dev-servers";
import { PREVIEW_PROFILE_VERSIONS } from "./schema";

/**
 * Which development server starts which application.
 *
 * Two properties carry this file. The table must be read most-specific-first,
 * because the frameworks it matches on are not mutually exclusive — and an
 * application it has no row for must get **nothing**, because a guessed start
 * command produces a public URL nobody should trust.
 */

describe("the most specific framework wins", () => {
  /*
   * Every one of these is a real co-declaration, not a contrived one. A Next.js
   * application's manifest declares `react`; a Nuxt one declares `vue`; a
   * SvelteKit one declares `vite`. Matching in declaration order rather than in
   * specificity order would start the wrong server for the right reason.
   */
  it("starts Next.js, not React's nothing, for an application declaring both", () => {
    expect(previewProfileForFrameworks(["react", "nextjs"])).toBe("next_dev_v1");
    expect(previewProfileForFrameworks(["nextjs", "react"])).toBe("next_dev_v1");
  });

  it("starts Nuxt, not Vue's nothing, for an application declaring both", () => {
    expect(previewProfileForFrameworks(["vue", "nuxt"])).toBe("nuxt_dev_v1");
  });

  /*
   * The row that made this property load-bearing rather than tidy.
   *
   * Astro, Nuxt and SvelteKit are all Vite servers, so a real manifest declares
   * `vite` alongside the framework's own id. With Vite anywhere but last, an
   * Astro application would be started by the bare `vite` binary — which would
   * *work*, serve the wrong thing, and never look like a bug.
   */
  it.each([
    ["astro", ["astro", "vite"], "astro_dev_v1"],
    ["nuxt", ["nuxt", "vite", "vue"], "nuxt_dev_v1"],
  ])("starts %s rather than the bare Vite server it is built on", (_label, frameworks, profile) => {
    expect(previewProfileForFrameworks(frameworks)).toBe(profile);
  });

  it("is the same answer whatever order the frameworks arrive in", () => {
    const forwards = previewServerCommandFor(["astro", "react"]);
    const backwards = previewServerCommandFor(["react", "astro"]);

    expect(forwards).toEqual(backwards);
    expect(forwards?.command).toBe("node_modules/.bin/astro");
  });
});

describe("an application with no server command gets none", () => {
  it.each([
    ["remix", ["remix", "react"]],
    ["express", ["express"]],
    ["react on its own, with no build tool named", ["react"]],
    ["nothing at all", []],
    ["a framework Vibe has never heard of", ["some-future-framework"]],
  ])("refuses %s", (_label, frameworks) => {
    expect(previewProfileForFrameworks(frameworks)).toBeNull();
    expect(previewServerCommandFor(frameworks)).toBeNull();
  });

  /*
   * SvelteKit has no row and still gets a server, which is the point of keying
   * on frameworks rather than on a framework: its own binary *is* `vite`, so
   * the Vite row starts it correctly and a row of its own would name the same
   * command twice.
   */
  it("starts SvelteKit with the Vite row rather than a row of its own", () => {
    expect(PREVIEWABLE_FRAMEWORKS).not.toContain("sveltekit");
    expect(previewProfileForFrameworks(["sveltekit", "svelte", "vite"])).toBe("vite_dev_v1");
  });
});

describe("what every command is, and is not", () => {
  const commands = PREVIEWABLE_FRAMEWORKS.map(
    (framework) => [framework, previewServerCommandFor([framework])!] as const,
  );

  it("covers every previewable framework", () => {
    // The guard on the guard: an empty list would satisfy every assertion below
    // while covering none of them.
    expect(commands.length).toBeGreaterThanOrEqual(3);
  });

  it.each(commands)("%s runs a binary the install put there, never a script", (_id, command) => {
    // `pnpm dev` would let a repository decide what Vibe serves on a public port
    // by editing one line of JSON; `npx` would let it decide over the network,
    // which is closed by the time this runs.
    expect(command.command).toMatch(/^node_modules\/\.bin\//);
    expect(command.args).not.toContain("run");
    expect(command.args.some((arg) => arg.includes("npx"))).toBe(false);
  });

  it.each(commands)("%s binds all interfaces on Vibe's port", (_id, command) => {
    // Stated rather than inherited: a server that silently became loopback-only
    // on a future default would fail its health check with no explanation.
    expect(command.args).toContain("0.0.0.0");
    expect(command.args).toContain(String(PREVIEW_BUDGETS.port));
  });

  it.each(commands)("%s names no port but Vibe's", (_id, command) => {
    // One port, and it is the budget's. A second number that looked like a port
    // would mean the command carried an opinion about where to serve that the
    // sandbox's exposed port does not share.
    const ports = command.args.filter((arg) => /^\d{2,5}$/.test(arg));

    expect(ports).toEqual([String(PREVIEW_BUDGETS.port)]);
  });
});

describe("every profile the table can name has a version", () => {
  it("names one for each previewable framework", () => {
    // The union is exhaustive by type, but a row whose profile had no version
    // would write a null into a not-null column at runtime.
    for (const framework of PREVIEWABLE_FRAMEWORKS) {
      const profile = previewProfileForFrameworks([framework]);
      expect(profile).not.toBeNull();
      expect(PREVIEW_PROFILE_VERSIONS[profile!]).toBeTruthy();
    }
  });
});

describe("Yarn Plug'n'Play has no binary to invoke", () => {
  /*
   * Under PnP there is no `node_modules/.bin/`, so every binary in the table is
   * simply absent — the server would fail to *start*, which is a worse outcome
   * than not offering a preview because it costs a sandbox to discover.
   *
   * Validation is unaffected: `yarn run build` resolves through `.pnp.cjs`. So
   * this costs the preview and nothing else, which is what the copy says.
   */
  it("offers no preview for a PnP application, whatever its framework", () => {
    expect(previewProfileForFrameworks(["nextjs"], { moduleLinker: "pnp" })).toBeNull();
    expect(previewProfileForFrameworks(["astro"], { moduleLinker: "pnp" })).toBeNull();
  });

  it("offers one for a Berry application that kept node_modules", () => {
    expect(previewProfileForFrameworks(["nextjs"], { moduleLinker: "node_modules" })).toBe(
      "next_dev_v1",
    );
  });

  it("offers one when the question does not apply", () => {
    // Null is "no Yarn lockfile here", not "we could not tell".
    expect(previewProfileForFrameworks(["nextjs"], { moduleLinker: null })).toBe("next_dev_v1");
    expect(previewProfileForFrameworks(["nextjs"])).toBe("next_dev_v1");
  });
});

/**
 * Telling a host-gated server which hostname it is served on.
 *
 * This is the half of the fix that makes a Vite preview *work*; the probe is
 * the half that makes a broken one *say so*. Neither is sufficient: without
 * this every Vite-based preview would fail honestly instead of serving, and
 * without the probe this could stop working and nobody would learn.
 */
describe("the hostname a host-gated server is told about", () => {
  const HOST = "abc123-3000.sandbox.vercel.app";

  it.each(["vite", "astro", "nuxt"])("gives %s the host it will be reached by", (framework) => {
    expect(previewServerEnvironmentFor([framework], HOST)).toEqual({
      __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: HOST,
    });
  });

  it("gives Next.js nothing, because it has no host gate", () => {
    // A variable set for a process that ignores it is noise in a diff and a
    // future reader's wrong conclusion about what Next.js needs.
    expect(previewServerEnvironmentFor(["nextjs", "react"], HOST)).toEqual({});
  });

  it("gives an application with no server at all nothing", () => {
    expect(previewServerEnvironmentFor(["express"], HOST)).toEqual({});
  });

  /*
   * The one value Vite would silently discard: it skips the variable entirely
   * if it contains a backslash or either quote. A hostname cannot contain those
   * — this asserts that what Vibe actually passes is a hostname, so the day
   * something else is passed here the test is the one that notices.
   */
  it("passes a value Vite will not reject out of hand", () => {
    const value = previewServerEnvironmentFor(
      ["vite"],
      HOST,
    ).__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS;

    expect(value).not.toMatch(/["'\\]/);
    expect(value).not.toContain(",");
  });
});
