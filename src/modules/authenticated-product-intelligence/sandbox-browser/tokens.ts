import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getBrowserSandboxEnv } from "@/lib/env/browser-sandbox";
import { BROWSER_RUNTIME_VERSION } from "./guard-program";

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
 * the VM's filesystem — and that token necessarily travels to a browser, since
 * it is the one that is *meant* to leave the server. So they are separate
 * values, and the guard routes them to separate channels with separate
 * vocabularies.
 *
 * ## Why they are derived rather than random
 *
 * Random was the first design here and it was wrong, for a reason that is a
 * property of the flow rather than of cryptography: **the manual-login
 * lifecycle spans two server requests.** A session is created in the first, the
 * person signs in by hand, and the analysis reconnects in the second — a
 * different function invocation with no shared memory. Something has to make
 * the token available again.
 *
 * The two ways to do that are to store it or to recompute it. Storing it puts a
 * bearer credential for a live browser — one already signed into a customer's
 * production application — into a database row, which is the exact artefact
 * ADR 0012 declined to hold. So it is recomputed: HMAC over the sandbox's own
 * name, keyed by one server-side secret that never leaves Vibe.
 *
 * That leaves nothing at rest. The database holds the sandbox name, which is
 * an identifier and not a capability (CLAUDE.md rule 52), and the tokens exist
 * only inside the request that derives them.
 *
 * ## The three things in the label, and why each is there
 *
 *  - **The purpose** (`control` / `view`) gives domain separation. Holding the
 *    view token must not let its holder compute the control token, and HMAC
 *    over distinct messages is what makes that true rather than hoped.
 *  - **The runtime version** so a guard whose behaviour changed cannot be
 *    reached by a token minted against the old one.
 *  - **The sandbox name**, which is what binds a token to one VM. A token for
 *    one session opens nothing in another.
 *
 * There is deliberately no timestamp and no expiry check. The sandbox has a
 * provider-side lifetime, and when that ends both tokens name nothing — an
 * expiry in the token would be a second clock to disagree with the first.
 */

export type BrowserSessionPurpose = "control" | "view";

export type BrowserSessionTokens = {
  /** Speaks CDP. Never leaves Vibe's server, never persisted. */
  control: string;
  /** Sees frames and sends bounded input. Travels to the owner's browser. */
  view: string;
};

function derive(secret: string, purpose: BrowserSessionPurpose, sandboxName: string): string {
  return createHmac("sha256", secret)
    .update(`${BROWSER_RUNTIME_VERSION}:${purpose}:${sandboxName}`)
    .digest("hex");
}

/**
 * The tokens for one sandbox, recomputed from its name.
 *
 * Deterministic on purpose: the same name yields the same pair in the request
 * that creates the session and in the request that reconnects to it.
 */
export function deriveBrowserSessionTokens(
  sandboxName: string,
  source?: Record<string, string | undefined>,
): BrowserSessionTokens {
  const { VIBE_BROWSER_SESSION_SECRET: secret } = getBrowserSandboxEnv(source);
  return {
    control: derive(secret, "control", sandboxName),
    view: derive(secret, "view", sandboxName),
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
