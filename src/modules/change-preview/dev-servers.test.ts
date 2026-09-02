import { describe, expect, it } from "vitest";
import { PREVIEW_BUDGETS } from "./budgets";
import {
  PREVIEWABLE_FRAMEWORKS,
  previewProfileForFrameworks,
  previewServerCommandFor,
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

  it("is the same answer whatever order the frameworks arrive in", () => {
    const forwards = previewServerCommandFor(["astro", "react"]);
    const backwards = previewServerCommandFor(["react", "astro"]);

    expect(forwards).toEqual(backwards);
    expect(forwards?.command).toBe("node_modules/.bin/astro");
  });
});

describe("an application with no server command gets none", () => {
  it.each([
    ["vite", ["vite", "react"]],
    ["sveltekit", ["sveltekit", "svelte", "vite"]],
    ["remix", ["remix", "react"]],
    ["express", ["express"]],
    ["nothing at all", []],
    ["a framework Vibe has never heard of", ["some-future-framework"]],
  ])("refuses %s", (_label, frameworks) => {
    expect(previewProfileForFrameworks(frameworks)).toBeNull();
    expect(previewServerCommandFor(frameworks)).toBeNull();
  });

  /*
   * Vite and SvelteKit are the deliberate absences, and the reason is not that
   * `vite` is hard to spell. Vite >= 5.4.12 refuses requests whose `Host` is
   * not in `server.allowedHosts`, and the sandbox serves on a public hostname —
   * while the health probe reaches the server over loopback and therefore
   * *passes*. A row here would record `running` for a page answering "Blocked
   * request." to everyone who opened it.
   */
  it("has no Vite row, and it is not an oversight", () => {
    expect(PREVIEWABLE_FRAMEWORKS).not.toContain("vite");
    expect(PREVIEWABLE_FRAMEWORKS).not.toContain("sveltekit");
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
