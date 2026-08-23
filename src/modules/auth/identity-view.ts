import { githubAvatarUrl } from "@/modules/github/identity";
import type { GithubIdentity } from "@/modules/github/types";

/**
 * Who to show in the account rail (CORE-6).
 *
 * ## The rule this module exists to hold
 *
 * **Never invent a name.** `src/app/app/(account)/page.tsx` has carried a
 * comment refusing to greet anyone by name, for the good reason that nothing
 * in this codebase stores one: no profile table, no `user_metadata`, no
 * display name, no avatar. `signUp` passes an email and a password and nothing
 * else.
 *
 * So there are exactly two identities available, in this order:
 *
 * 1. **The GitHub login.** A real name a person chose, stored because they
 *    authenticated with it. This is an identity.
 * 2. **The email address.** Shown in full, as an address. It is not converted
 *    into a name — "tobivlog@outlook.de" does not become "Tobi", because that
 *    is a guess about a person presented as a fact about them.
 *
 * Initials are the one derivation allowed, and only because they are visibly a
 * shorthand rather than a claim: nobody reads "TO" in a circle as an assertion
 * about someone's name.
 */

export type AccountIdentity = {
  /** What the rail prints. A login, an address, or a neutral label. */
  displayName: string;
  /** One or two uppercase characters for the avatar fallback. */
  initials: string;
  /** Null when there is no picture to attempt. */
  avatarUrl: string | null;
  /** True when the name came from GitHub rather than from an address. */
  fromGithub: boolean;
};

/**
 * Two characters where the handle has two parts, otherwise the first two of
 * the single token.
 *
 * Splitting on separators first is what makes `ada-lovelace` read as `AL`
 * rather than `AD`. Digits are kept — a login like `tobib1505` is one token and
 * `TO` is the honest shorthand for it.
 */
export function initialsFrom(handle: string): string {
  const parts = handle
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();

  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

export function buildAccountIdentity(input: {
  email: string | null;
  github: GithubIdentity | null;
}): AccountIdentity {
  if (input.github) {
    return {
      displayName: input.github.githubLogin,
      initials: initialsFrom(input.github.githubLogin),
      avatarUrl: githubAvatarUrl(input.github.githubUserId),
      fromGithub: true,
    };
  }

  if (input.email) {
    return {
      // The whole address, not the local part. An address is what we have; a
      // name is not, and truncating one into the other manufactures the second.
      displayName: input.email,
      initials: initialsFrom(input.email.split("@")[0] ?? input.email),
      avatarUrl: null,
      fromGithub: false,
    };
  }

  /*
   * Neither. Reachable in principle — the session type allows a null email —
   * and the answer is a label about the account rather than anything about the
   * person. The initial is the label's own first letter, which claims nothing.
   */
  return { displayName: "Your account", initials: "Y", avatarUrl: null, fromGithub: false };
}
