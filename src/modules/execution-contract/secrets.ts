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
 * The patterns below are deliberately narrow and high-signal: recognisable
 * credential prefixes and PEM headers, nothing that guesses at entropy. A
 * narrow matcher that never fires on ordinary prose is useful; a broad one that
 * rejects the word "secret" trains people to route around it.
 */

/**
 * Credential shapes worth refusing outright.
 *
 * Each is a vendor-defined prefix or a standard block header — a string that
 * has no meaning other than "this is a credential". Ordinary English cannot
 * produce one by accident.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{8,}/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\brk_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bwhsec_[A-Za-z0-9]{8,}/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  // A service-role key is the one Supabase credential that bypasses RLS, so its
  // assignment form is worth catching even without a recognisable body.
  /\bSUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*\S/i,
];

/** True when a string contains something that can only be a credential. */
export function containsCredentialMaterial(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

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
