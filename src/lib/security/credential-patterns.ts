/**
 * The one list of credential shapes this repository recognises.
 *
 * It exists in a shared place because it has two consumers with opposite
 * reactions to a match, and a second copy would drift: the execution contract
 * **refuses** free text that contains a credential
 * (`modules/execution-contract/secrets.ts`), and the error reporter **redacts**
 * one before an event leaves the process (`lib/observability/scrub.ts`).
 * Refusing and redacting are different decisions about the same fact, and the
 * fact should be established once.
 *
 * The patterns are deliberately narrow and high-signal: vendor-defined prefixes
 * and standard block headers — strings that have no meaning other than "this is
 * a credential". Nothing here guesses at entropy. A narrow matcher that never
 * fires on ordinary prose is useful; a broad one that trips on the word
 * "secret" trains people to route around it.
 *
 * They are also not a boundary. A scanner is a guess about strings, and a guess
 * that fails open looks like protection without being it. What actually keeps
 * credentials out of a spec is that an `ExecutionSpec` has no field one could
 * occupy; what keeps them out of Sentry is `sendDefaultPii: false` and dropping
 * request bodies, cookies and query strings wholesale. This list is the third
 * layer, not the first.
 */

/** Source patterns, unanchored and without flags, so both forms derive from one place. */
const CREDENTIAL_SOURCES: readonly string[] = [
  String.raw`\bsk-ant-[A-Za-z0-9_-]{8,}`,
  String.raw`\bsk_(?:live|test)_[A-Za-z0-9]{8,}`,
  String.raw`\brk_(?:live|test)_[A-Za-z0-9]{8,}`,
  String.raw`\bwhsec_[A-Za-z0-9]{8,}`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{16,}`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{16,}`,
  String.raw`\bAKIA[0-9A-Z]{12,}`,
  String.raw`\bxox[abposr]-[A-Za-z0-9-]{8,}`,
  String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----`,
  String.raw`\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}`,
  // A service-role key is the one Supabase credential that bypasses RLS, so its
  // assignment form is worth catching even without a recognisable body.
  String.raw`SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*\S+`,
];

/** For asking whether a string contains one. Never global — `lastIndex` would carry between calls. */
export const CREDENTIAL_PATTERNS: readonly RegExp[] = CREDENTIAL_SOURCES.map(
  (source) => new RegExp(source, "i"),
);

/** For replacing every occurrence. Built separately for the same `lastIndex` reason. */
const CREDENTIAL_REPLACERS: readonly RegExp[] = CREDENTIAL_SOURCES.map(
  (source) => new RegExp(source, "gi"),
);

/** What a redacted value reads as. Says a value was removed rather than that none was there. */
export const REDACTED = "[redacted]";

/** True when a string contains something that can only be a credential. */
export function containsCredentialMaterial(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Replaces every recognised credential in a string with {@link REDACTED}.
 *
 * The surrounding text survives, because the surrounding text is usually the
 * whole reason the string is being reported — a stack frame, an error message,
 * a URL. Removing the credential and keeping the sentence is what makes the
 * report still worth having.
 */
export function redactCredentials(value: string): string {
  let result = value;
  for (const pattern of CREDENTIAL_REPLACERS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, REDACTED);
  }
  return result;
}
