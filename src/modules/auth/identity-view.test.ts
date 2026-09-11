import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAccountIdentity, greetableName, initialsFrom } from "./identity-view";
import type { GithubIdentity } from "@/modules/github/types";

/** One connected account, for the greeting rule below. */
const GITHUB: GithubIdentity = { githubLogin: "ada-lovelace", githubUserId: 1 } as GithubIdentity;

/**
 * Who the account rail says you are (CORE-6).
 *
 * Every test here is one shape of the same rule: the product may show what it
 * was told and may abbreviate it, and may not turn an address into a name.
 * That rule is easy to state and one `.split("@")[0]` away from being broken by
 * someone making the rail look friendlier.
 */

describe("the name comes from GitHub when there is one", () => {
  it("uses the login a person actually authenticated with", () => {
    const identity = buildAccountIdentity({
      email: "someone@example.com",
      github: { githubUserId: 4242, githubLogin: "ada-lovelace" },
    });

    expect(identity.displayName).toBe("ada-lovelace");
    expect(identity.fromGithub).toBe(true);
  });

  it("addresses the avatar by user id, so no URL has to be stored", () => {
    const identity = buildAccountIdentity({
      email: null,
      github: { githubUserId: 4242, githubLogin: "ada" },
    });

    expect(identity.avatarUrl).toContain("avatars.githubusercontent.com/u/4242");
  });

  it("prefers the login over the address, because only one of them is a name", () => {
    const identity = buildAccountIdentity({
      email: "totally.different@example.com",
      github: { githubUserId: 1, githubLogin: "ada" },
    });

    expect(identity.displayName).toBe("ada");
  });
});

describe("without GitHub, the address stays an address", () => {
  /**
   * The rule the whole module exists for. "tobivlog@outlook.de" must not become
   * "Tobi": that is a guess about a person rendered as a fact about them, and
   * the dashboard headline has refused to make it since it was written.
   */
  it("never turns an email into a first name", () => {
    const identity = buildAccountIdentity({ email: "tobivlog@outlook.de", github: null });

    expect(identity.displayName).toBe("tobivlog@outlook.de");
    expect(identity.displayName).toContain("@");
    expect(identity.fromGithub).toBe(false);
  });

  it("attempts no picture, rather than a placeholder face", () => {
    expect(buildAccountIdentity({ email: "a@b.com", github: null }).avatarUrl).toBeNull();
  });

  it("falls back to a label about the account when there is nothing at all", () => {
    const identity = buildAccountIdentity({ email: null, github: null });

    expect(identity.displayName).toBe("Your account");
    expect(identity.initials).toBe("Y");
  });
});

describe("initials are a shorthand, not a claim", () => {
  it("takes one letter from each part of a two-part handle", () => {
    expect(initialsFrom("ada-lovelace")).toBe("AL");
    expect(initialsFrom("ada.lovelace")).toBe("AL");
    expect(initialsFrom("ada_lovelace")).toBe("AL");
  });

  it("takes the first two characters of a single token, digits included", () => {
    // A login is often one word with numbers in it, and "TO" is the honest
    // shorthand for `tobib1505` — there is no second word to find.
    expect(initialsFrom("tobib1505")).toBe("TO");
    expect(initialsFrom("ada")).toBe("AD");
  });

  it("never returns more than two characters", () => {
    for (const handle of ["a-b-c-d", "one.two.three", "verylongsinglehandle"]) {
      expect(initialsFrom(handle).length).toBeLessThanOrEqual(2);
    }
  });

  it("returns nothing rather than punctuation for a handle with no letters", () => {
    // The avatar renders an empty tile in that case, which is a shape. A "?"
    // or a "•" would read as an error state that has not occurred.
    expect(initialsFrom("---")).toBe("");
  });
});

describe("what Nova may call somebody", () => {
  /*
   * The rail and a greeting ask different questions, and the difference is the
   * whole of this function. "Who is signed in" has three answers and an email
   * address is a good one; "what do I call you" has two, because an address is
   * not an answer to it at all.
   */
  it("prefers the name the founder gave over the login they authenticated with", () => {
    expect(greetableName({ github: GITHUB, founderName: "Tobi" })).toBe("Tobi");
  });

  it("falls back to the login, which is a name somebody chose", () => {
    expect(greetableName({ github: GITHUB, founderName: null })).toBe("ada-lovelace");
  });

  /*
   * The rule this module exists for. There is no third branch reading an
   * email, so there is nothing here that could ever shorten one into a first
   * name — `novaGreeting`'s nameless form is the answer instead, and it is a
   * greeting rather than a gap.
   */
  it("never answers with an address, because an address is not a name", () => {
    expect(greetableName({ github: null })).toBeNull();
    expect(greetableName({ github: null, founderName: null })).toBeNull();
  });

  it("agrees with the rail about which identity wins", () => {
    const identity = buildAccountIdentity({
      email: "founder@example.com",
      github: GITHUB,
      founderName: "Tobi",
    });
    expect(identity.displayName).toBe(greetableName({ github: GITHUB, founderName: "Tobi" }));
  });
});

describe("every screen that builds an identity asks for the name", () => {
  /*
   * The bug this exists for was not a wrong answer. `buildAccountIdentity`
   * prefers the founder's own name and always has; the rail simply never
   * passed one, so it rendered a real identity that was not theirs — and
   * nothing failed, because an optional argument left out is not an error.
   *
   * A founder could type what they wanted to be called in Settings → Profile,
   * see it there, and find their GitHub login on every other screen. One call
   * site, one missing argument, no signal anywhere.
   *
   * So this sweeps the call sites rather than pinning the one that was wrong.
   * A new surface that builds an identity has to decide about the name, and
   * the way to decide is to pass it.
   */
  const APP = join(process.cwd(), "src", "app");

  const callSites = (dir: string): { file: string; call: string }[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return callSites(path);
      if (!entry.name.endsWith(".tsx") && !entry.name.endsWith(".ts")) return [];
      if (entry.name.endsWith(".test.ts")) return [];
      const body = readFileSync(path, "utf8");
      return [...body.matchAll(/buildAccountIdentity\(\{[^}]*\}\)/g)].map((match) => ({
        file: path.slice(APP.length + 1),
        call: match[0],
      }));
    });

  it("passes a founderName wherever it builds one", () => {
    const sites = callSites(APP);

    // If this drops to zero the sweep has stopped sweeping, not the app.
    expect(sites.length).toBeGreaterThan(0);

    const silent = sites.filter((site) => !site.call.includes("founderName"));
    expect(silent.map((site) => site.file)).toEqual([]);
  });
});
