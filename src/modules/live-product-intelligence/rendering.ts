import type { ParsedHtml } from "./html";

/**
 * Whether a fetched page could actually be read (Sprint 0082).
 *
 * ## The failure this exists to name
 *
 * Vibe reads HTML over HTTP and deliberately runs no browser — [ADR 0010] and
 * CLAUDE.md rule 38, which bans exactly the headless-browser dependencies that
 * would make this problem go away. That is a sound decision and this module does
 * not revisit it. What it fixes is that the limit was **silent**.
 *
 * A client-rendered application serves a mount element and a script tag. It
 * returns HTTP 200, costs a few kilobytes, and parses to zero headings, zero
 * links, zero buttons, zero forms and no prices. Every one of those zeroes then
 * travelled into the snapshot, the evidence pack and the founder's screen as a
 * *fact about the product* — "no calls to action", "no pricing", "no signup
 * form" — when the truthful sentence was "Vibe could not see this page".
 *
 * That is precisely the confusion the audit's own `insufficient_evidence` rule
 * exists to prevent, and rule 44 states the principle: missing evidence must
 * never be represented as a bad result, enforced in code rather than in a
 * prompt. Until now nothing enforced it for this cause, because nothing knew.
 *
 * ## Why two verdicts and not one
 *
 * `empty` and `client_rendered` are different statements and only one of them
 * is about Vibe.
 *
 * A coming-soon page with a line of text really is nearly empty, and Vibe read
 * it correctly. Reporting that as "could not read" would be a false alarm, and
 * would teach a founder to ignore the warning that matters. So emptiness alone
 * is recorded as what it is — an observation about the page — and changes
 * nothing about the snapshot's completeness.
 *
 * `client_rendered` adds a second, independent fact: the document carries a
 * mount element with nothing inside it, or says in its own `<noscript>` that it
 * needs JavaScript to work. Both are the page describing itself. Only that
 * combination claims the read failed.
 */
export type PageRendering = "readable" | "empty" | "client_rendered";

/**
 * The visible-character count below which a page is treated as carrying no
 * readable content.
 *
 * Deliberately generous. It never decides alone: a page must also have no
 * heading and no form to be called sparse at all, and those two carry most of
 * the weight. This guards the remaining case — a page with a paragraph of prose
 * and no structure — from being called empty because it lacks an `<h1>`.
 */
const MIN_READABLE_TEXT = 200;

/**
 * True when nothing a reader would use came back.
 *
 * Headings and forms are required to be absent rather than merely few, because
 * either one is proof the server sent real markup. A page with an `<h1>` was
 * rendered on the server whatever else it lacks.
 */
function isSparse(parsed: ParsedHtml): boolean {
  return (
    parsed.visibleTextLength < MIN_READABLE_TEXT &&
    parsed.headings.length === 0 &&
    parsed.forms.length === 0
  );
}

/**
 * The verdict for one page.
 *
 * Sparseness is required for both non-readable verdicts, which is what keeps
 * the self-description signals honest. A content site that renders perfectly
 * well may still ship "please enable JavaScript for the best experience" in a
 * `<noscript>`, and a server-rendered framework emits its mount element with
 * the markup *inside* it. Neither is evidence of anything on a page that
 * already gave us something to read.
 */
export function classifyRendering(parsed: ParsedHtml): PageRendering {
  if (!isSparse(parsed)) return "readable";
  return parsed.hasEmptyMountElement || parsed.requiresJavaScript ? "client_rendered" : "empty";
}
