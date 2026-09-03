import { SANDBOX_BUDGETS } from "./budgets";

/**
 * Making untrusted build output safe to store (Sprint 10A §15).
 *
 * Every byte here was produced by code Vibe did not write, inside a VM whose
 * whole purpose is running things we do not trust. Build output is therefore
 * **hostile input**, in the same category as repository file contents and
 * customer web pages (CLAUDE.md rules 25, 36).
 *
 * Concretely, output can:
 *
 *  - carry ANSI/OSC escapes that rewrite a reviewer's terminal or hyperlink to
 *    somewhere else entirely;
 *  - contain a single 40 MB line, which is a denial-of-service against the
 *    database and every renderer downstream;
 *  - be binary, if a build decides to dump a compiled artifact to stdout;
 *  - contain HTML that would execute if a future surface rendered it unescaped;
 *  - echo a token that the customer's own CI put in their environment.
 *
 * The UI comes in 10B, but storage must already be safe — a sanitizer added
 * later cannot clean rows that were written earlier.
 */

/**
 * Control characters that never belong in stored output.
 *
 * Tab (`\x09`) and newline (`\x0a`) are preserved because they carry real
 * structure. Everything else in C0/C1, plus DEL, is dropped.
 *
 * Two in particular: `\x1b` is the entry point for CSI colour codes, OSC 8
 * hyperlinks and terminal title rewriting, and `\x0d` (carriage return) is how
 * a progress bar overwrites the line above it — which is also how output can be
 * made to read very differently from what was actually printed.
 */
const CONTROL_CHARACTERS = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g;

/** ANSI escape sequences, stripped as sequences before stray bytes are dropped. */
const ANSI_SEQUENCES = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/**
 * Values worth redacting on sight.
 *
 * This is a safety net, not the control: the sandbox is not given any Vibe or
 * customer secret in the first place (§8), and a redactor is a poor substitute
 * for absence. It exists because the *customer's* repository may print its own
 * tokens during a build, and storing those would make Vibe's database a
 * secondary breach surface.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{16,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /(?<=(?:authorization|token|secret|password|api[_-]?key)["'\s:=]{1,4})[A-Za-z0-9_\-.]{16,}/gi,
];

const REDACTED = "[redacted]";

/** Output that is mostly non-text is described rather than stored. */
function looksBinary(text: string): boolean {
  if (text.length === 0) return false;

  let suspicious = 0;
  const sampled = Math.min(text.length, 2048);
  for (let index = 0; index < sampled; index += 1) {
    const code = text.charCodeAt(index);
    // NUL and unpaired replacement characters are the reliable tells.
    if (code === 0 || code === 0xfffd) suspicious += 1;
  }

  // Both an absolute floor and a ratio. The ratio alone misfires on short
  // output — one stray NUL in a 14-character line is 7%, and a build that
  // prints a single control byte is not a binary dump. Those get their control
  // characters stripped below, which is the correct handling.
  return suspicious >= 4 && suspicious / sampled > 0.05;
}

export type SanitizedOutput = { text: string; truncated: boolean };

/**
 * Bounded, escape-free, secret-scrubbed tail of a command's output.
 *
 * The **tail**, not the head: a build prints hundreds of progress lines and
 * then the reason it failed. Keeping the beginning would reliably store the
 * least useful part.
 */
export function sanitizeCommandOutput(raw: string): SanitizedOutput {
  if (raw.length === 0) return { text: "", truncated: false };

  // Bound first. Everything downstream is regex work, and running it across an
  // unbounded string is its own denial of service.
  const overBudget = raw.length > SANDBOX_BUDGETS.maxCapturedOutputBytes;
  const bounded = overBudget ? raw.slice(-SANDBOX_BUDGETS.maxCapturedOutputBytes) : raw;

  if (looksBinary(bounded)) {
    return { text: "[binary output omitted]", truncated: true };
  }

  let text = bounded.replace(ANSI_SEQUENCES, "").replace(CONTROL_CHARACTERS, "");
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, REDACTED);

  const lines = text
    .split("\n")
    .map((line) =>
      line.length > SANDBOX_BUDGETS.maxLineChars
        ? `${line.slice(0, SANDBOX_BUDGETS.maxLineChars)}…[truncated]`
        : line,
    );

  const droppedLines = lines.length > SANDBOX_BUDGETS.maxStoredOutputLines;
  const tailLines = droppedLines ? lines.slice(-SANDBOX_BUDGETS.maxStoredOutputLines) : lines;

  let joined = tailLines.join("\n").trimEnd();
  const overChars = joined.length > SANDBOX_BUDGETS.maxStoredOutputChars;
  if (overChars) joined = joined.slice(-SANDBOX_BUDGETS.maxStoredOutputChars);

  return { text: joined, truncated: overBudget || droppedLines || overChars };
}
