import { describe, expect, it } from "vitest";
import { buildAccountIdentity, initialsFrom } from "./identity-view";

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
