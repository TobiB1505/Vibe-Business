import { githubAvatarUrl } from "@/modules/github/identity";
import type { GithubIdentity } from "@/modules/github/types";
import { initialsFrom } from "./initials";

export { initialsFrom } from "./initials";

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
 * That was true until a founder could be **asked**, which is what
 * `founder-profile.ts` changed. Asking is the one way to have a name without
 * guessing, so it goes first — and everything below it is unchanged, because
 * the refusal to invent one never depended on there being no name at all.
 *
 * So there are three identities available, in this order:
 *
 * 1. **The name the founder gave.** They typed it about themselves; nothing is
 *    derived and nothing is guessed. Absent until they are asked.
 * 2. **The GitHub login.** A real name a person chose, stored because they
 *    authenticated with it. This is an identity.
 * 3. **The email address.** Shown in full, as an address. It is not converted
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
  /**
   * True when the founder typed this name about themselves.
   *
   * The one signal that separates a name from an identifier, and the only
   * case where greeting somebody by it claims nothing they did not say.
   */
  chosen: boolean;
};

export function buildAccountIdentity(input: {
  email: string | null;
  github: GithubIdentity | null;
  /** What the founder asked to be called, when they have said. */
  founderName?: string | null;
}): AccountIdentity {
  if (input.founderName) {
    return {
      displayName: input.founderName,
      initials: initialsFrom(input.founderName),
      /* Vibe stores no picture of its own; a connected GitHub still has one. */
      avatarUrl: input.github ? githubAvatarUrl(input.github.githubUserId) : null,
      fromGithub: false,
      chosen: true,
    };
  }

  if (input.github) {
    return {
      displayName: input.github.githubLogin,
      initials: initialsFrom(input.github.githubLogin),
      avatarUrl: githubAvatarUrl(input.github.githubUserId),
      fromGithub: true,
      chosen: false,
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
      chosen: false,
    };
  }

  /*
   * Neither. Reachable in principle — the session type allows a null email —
   * and the answer is a label about the account rather than anything about the
   * person. The initial is the label's own first letter, which claims nothing.
   */
  return {
    displayName: "Your account",
    initials: "Y",
    avatarUrl: null,
    fromGithub: false,
    chosen: false,
  };
}
