import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The two capabilities a browser sandbox hands out (ADR 0076).
 *
 * ## Why two, and why they are not the same one
 *
 * The sandbox exposes exactly one public port, and two very different callers
 * arrive on it:
 *
 *  - **Vibe's own server**, which needs the Chrome DevTools Protocol to drive
 *    the read-only analysis. Full control of the browser.
 *  - **The signed-in owner's browser**, which needs to see the page and click
 *    and type into it so they can log in. Nothing more.
 *
 * Giving both the same token would give the second one the first one's power.
 * A live-view token that could speak CDP could navigate to `file://` and read
 * the VM's filesystem, and that token necessarily travels to a browser — it is
 * the one that is *meant* to leave the server. So they are separate values,
 * and the guard routes them to separate channels with separate vocabularies:
 * `control` reaches CDP, `view` reaches frames-out and a closed set of input
 * events in.
 *
 * ## Why they are random rather than signed
 *
 * A signed token would let the guard verify without holding a secret, which is
 * the right design when the verifier is untrusted. Here it is not: the guard is
 * Vibe's own program, in a VM that holds no customer code and no Vibe
 * credential, created seconds earlier for one session. There is nothing for a
 * signature to protect against that a random 256-bit value does not, and an
 * HMAC scheme would add key handling, clock skew and an expiry check — three
 * things to get wrong in place of `timingSafeEqual`.
 *
 * Expiry is not this file's job either. The sandbox has a provider-side
 * lifetime, and when it ends both tokens name nothing.
 *
 * ## What is deliberately absent
 *
 * There is no `parse`, no `decode`, and no way to learn anything from a token.
 * It carries no session id, no purpose and no timestamp, because a value that
 * *tells* you what it opens is a value somebody will read out of a log and use.
 * The guard knows which token is which because Vibe handed it exactly two.
 */

/** 32 bytes, hex. Long enough that guessing is not a threat model. */
const TOKEN_BYTES = 32;

export type BrowserSessionTokens = {
  /** Speaks CDP. Never leaves Vibe's server. */
  control: string;
  /** Sees frames and sends bounded input. Travels to the owner's browser. */
  view: string;
};

export function mintBrowserSessionTokens(): BrowserSessionTokens {
  return {
    control: randomBytes(TOKEN_BYTES).toString("hex"),
    view: randomBytes(TOKEN_BYTES).toString("hex"),
  };
}

/**
 * Constant-time comparison of a presented token against an expected one.
 *
 * Exported because the guard program needs the identical rule, and a second
 * implementation of "are these equal" is how the two drift into a length check
 * that answers early. `timingSafeEqual` throws on a length mismatch, so the
 * length is compared first and separately — that comparison leaks only the
 * length, which is a constant here.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  if (typeof presented !== "string" || presented.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
