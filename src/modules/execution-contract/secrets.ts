import { containsCredentialMaterial } from "@/lib/security/credential-patterns";

/**
 * Secret material must not exist in a spec (EXECUTION CORE-3 §11, §48).
 *
 * ## The primary defence is the schema, not this file
 *
 * §48 is explicit that broad secret scanning must not be the only defence, and
 * it is right: a scanner is a guess about strings, and a guess that fails open
 * is worse than nothing because it looks like protection.
 *
 * So the real defence is structural, and it is in `spec.ts`: an `ExecutionSpec`
 * has **no field a credential could legitimately occupy**. No token, no key, no
 * connection string, no header map, no environment block. The secret policy is
 * a single value — `unavailable` — and the spec describes *that authentication
 * is configured*, never *what it is*. There is nowhere to put a secret, which
 * is a property no scanner can offer.
 *
 * ## What this file is for
 *
 * Defence in depth on the handful of fields that carry free text at all — the
 * objective, which is the Planner's prose, and any recorded decision label.
 * Those come from a model and from a human typing into a form, and a founder
 * who pastes a Stripe key into a plan step should not have it copied into a
 * durable artifact.
 *
 * The patterns it matches against are deliberately narrow and high-signal:
 * recognisable credential prefixes and PEM headers, nothing that guesses at
 * entropy. A narrow matcher that never fires on ordinary prose is useful; a
 * broad one that rejects the word "secret" trains people to route around it.
 */

/**
 * The pattern list lives in `lib/security/credential-patterns.ts`, because the
 * error reporter needs the same fact and reacts to it differently — it redacts
 * where this module refuses. Two copies of a security-relevant list is two
 * lists that drift.
 */

export { containsCredentialMaterial };

export class SecretMaterialRejected extends Error {
  constructor(readonly field: string) {
    super(
      `Refused to build an ExecutionSpec: "${field}" contains credential-shaped content. ` +
        "A spec may describe that authentication is required; it may never carry a secret value.",
    );
    this.name = "SecretMaterialRejected";
  }
}

/**
 * Rejects credential-shaped content in a free-text field (§11, §48).
 *
 * Throws rather than sanitizing. Silently stripping a key would produce a spec
 * that reads as though the founder wrote something they did not, and would hide
 * from them that a credential is sitting in their Action Plan where it can
 * still be read.
 */
export function assertNoSecretMaterial(field: string, value: string): void {
  if (containsCredentialMaterial(value)) throw new SecretMaterialRejected(field);
}
