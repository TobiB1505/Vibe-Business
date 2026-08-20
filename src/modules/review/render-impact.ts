import ts from "typescript";
import { isRenderImpactCandidate } from "./route-segment";

/**
 * Proving a changed file *cannot* have altered rendered output.
 *
 * ## The defect this exists for
 *
 * A real production run (2026-08-20, `5ea8a9a0`) changed nothing but the
 * `export const metadata` object in `src/app/layout.tsx` and
 * `src/app/app/layout.tsx` — adding robots directives — and was recommended
 * for a *visual* review. `public_visual_review_v1` would have photographed the
 * page before and after and produced two identical images: a confident,
 * useless result that looks like a review. `classification.ts`'s own doc
 * comment names that exact failure mode as the thing it exists to prevent, and
 * it happened anyway, because the classifier decides from *paths* and a path
 * cannot say what inside the file moved.
 *
 * ## What this claims, and what it never claims
 *
 * One direction only. A `no_render_impact` verdict means **the entire
 * non-metadata program text is byte-identical between the two versions**, so
 * nothing that can reach the DOM changed. Everything else — including every
 * kind of failure — is `unproven`, which leaves the path-based answer standing.
 *
 * It can never prove a change *is* visible. It will not see a transitively
 * changed imported component, or a constant elsewhere that feeds this file's
 * JSX. Both correctly stay visual, because both leave this file's remainder
 * unchanged only when this file genuinely did not change.
 *
 * ## Why remainder comparison rather than diff-hunk intersection
 *
 * The obvious alternative — "every changed line falls inside a metadata range"
 * — needs a diff algorithm Vibe does not have, or GitHub's patch text (a new
 * parser, computed against a merge base Vibe does not control), and then needs
 * those hunks mapped into two files whose line numbers have shifted. It is a
 * positive claim resting on somebody else's alignment.
 *
 * Stripping and comparing remainders is a total function of each version
 * independently. No alignment, no diff, no third party — and the sentence it
 * supports is the stronger one.
 *
 * ## Why the ranges splice cleanly
 *
 * For siblings in a statement list the TypeScript parser sets
 * `statements[i+1].pos === statements[i].end` — `pos` is the end of the
 * *previous* token, not the start of this one's text. So removing the full
 * `[pos, end)` range of any subset of top-level statements yields exactly the
 * text that would exist had those statements never been written: adjacent
 * removed ranges are contiguous, leaving no interior whitespace artifact at
 * all. Only the file's two edges are affected — a stripped first statement
 * takes the leading trivia with it, a stripped last one leaves the trailing
 * newline — so a single `.trim()` covers both.
 *
 * That is why the normalization here is **CRLF/CR → LF, then trim, and nothing
 * else**. Dropping blank lines would be actively unsafe: a blank line inside a
 * template literal is semantic and renders, and JSX text nodes are whitespace-
 * sensitive. A re-indentation of the render path must resolve to
 * `render_path_changed`, and it does.
 *
 * ## Why the agent cannot talk its way past this
 *
 * The analysis reads *syntax*, never meaning. Text inside a stripped statement
 * is removed from both versions and never examined; text outside one is a
 * difference that keeps the file visual. There is nothing an agent could write
 * — in a comment, a string, a commit message — that buys its own change a
 * cheaper review. That property is why reading file content is permissible here
 * at all (Rule 57).
 *
 * ## Rule 26
 *
 * Nothing here persists. Both versions arrive as strings, are reduced to a
 * verdict, and go out of scope. The verdict carries export *names* and a
 * reason — never a byte of the customer's source. Callers must keep it that
 * way: no fetched text may reach a log line, an error message or a breadcrumb.
 */

/**
 * Bounds shared by this module and its caller, so the cap that decides how many
 * files may be inspected lives beside the rule that inspects them — the same
 * arrangement `execution/diff.ts` uses for `DIFF_LIMITS`.
 */
export const RENDER_IMPACT_LIMITS = {
  /** Matches `DIFF_LIMITS.maxBytesPerFile`. A layout is a few hundred bytes. */
  maxBytesPerFile: 64 * 1024,
  /** How many candidates one classification may fetch. Two reads each. */
  maxFilesInspected: 6,
} as const;

export const RENDER_IMPACT_UNPROVEN_REASONS = [
  /** Not a route segment file, so the framework guarantee below does not hold. */
  "not_a_route_segment",
  /** No base version: a genuinely new page, or a read that failed. Both are visible. */
  "no_base_version",
  /** The head version could not be read — deleted, binary, or over the byte cap. */
  "content_unavailable",
  /** Either version failed to parse, or the parser could not be asked. */
  "unparseable",
  /** The ordinary outcome for a real UI change: something outside the stripped set moved. */
  "render_path_changed",
  /** More candidates than one classification may inspect. */
  "budget_exceeded",
] as const;
export type RenderImpactUnprovenReason = (typeof RENDER_IMPACT_UNPROVEN_REASONS)[number];

export type RenderImpactVerdict =
  | {
      kind: "no_render_impact";
      /** Which exports were removed to reach that conclusion. Names only, never content. */
      strippedExports: readonly string[];
    }
  | { kind: "unproven"; reason: RenderImpactUnprovenReason };

/**
 * Exports the App Router reads as configuration, which never enter the element
 * tree.
 *
 * Two families. The **Metadata API** is serialized into `<head>`; the **route
 * segment config** decides when and where a segment runs. Neither can paint a
 * pixel inside the page.
 *
 * `generateStaticParams` is deliberately **absent**. It decides which URLs
 * exist at all, so changing it can turn a page into a 404 — and a 404 is very
 * much a different screenshot. It looks like it belongs in this list and it
 * does not.
 */
const NON_RENDERING_EXPORTS: ReadonlySet<string> = new Set([
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "dynamic",
  "dynamicParams",
  "revalidate",
  "fetchCache",
  "runtime",
  "preferredRegion",
  "maxDuration",
]);

/**
 * The route-segment guard lives in its own module (`route-segment.ts`) so a
 * caller can ask "is this even a candidate?" — and skip the network — without
 * importing this file and the ~9 MB compiler with it. Re-exported here because
 * this is where the rule it guards lives, and the two belong together in a
 * reader's mind even though they must not in the module graph.
 */
export { isRenderImpactCandidate } from "./route-segment";

function unproven(reason: RenderImpactUnprovenReason): RenderImpactVerdict {
  return { kind: "unproven", reason };
}

/** CRLF/CR → LF only. See the module doc for why nothing else is touched. */
function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** True when the statement carries an `export` modifier. */
function isExported(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) return false;
  return (
    ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ??
    false
  );
}

/**
 * The non-rendering export names this statement declares, or null when it
 * declares something else.
 *
 * A variable statement qualifies only when **every** declarator is in the set.
 * `export const metadata = {...}, HERO = "welcome";` declares one of each, so
 * it is left in the remainder entirely — any change to it keeps the file
 * visual. Conservative, and the direction the whole module leans.
 */
function nonRenderingNames(statement: ts.Statement): readonly string[] | null {
  if (!isExported(statement)) return null;

  if (ts.isVariableStatement(statement)) {
    const names: string[] = [];
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) return null;
      if (!NON_RENDERING_EXPORTS.has(declaration.name.text)) return null;
      names.push(declaration.name.text);
    }
    return names.length > 0 ? names : null;
  }

  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text;
    if (name && NON_RENDERING_EXPORTS.has(name)) return [name];
  }

  // Everything else — including `export { metadata } from "./x"`, which names
  // no local declaration to strip — stays in the remainder.
  return null;
}

type Stripped = { remainder: string; names: readonly string[] } | null;

/**
 * The file with its non-rendering exports removed, or null when it could not be
 * parsed.
 *
 * `ts.createSourceFile` never throws — it error-recovers and records what went
 * wrong on `parseDiagnostics`, which is internal and absent from the public
 * `SourceFile` type. It is read defensively here, and **absence is treated as
 * failure**: if a future TypeScript stops exposing it, this degrades to "always
 * visual", which is the safe direction. A test asserts the field is present and
 * non-empty for a known-broken fixture, so that degradation fails loudly rather
 * than silently disabling the feature.
 */
function strip(path: string, text: string): Stripped {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    // Parent pointers are not needed: only top-level statements are examined.
    false,
    // Mandatory. In `.ts` mode `<div>` parses as a type assertion, not JSX.
    ts.ScriptKind.TSX,
  );

  const diagnostics = (source as unknown as { parseDiagnostics?: readonly unknown[] })
    .parseDiagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length > 0) return null;

  const names: string[] = [];
  const keep: string[] = [];
  let cursor = 0;

  for (const statement of source.statements) {
    const stripped = nonRenderingNames(statement);
    if (stripped === null) continue;

    names.push(...stripped);
    keep.push(text.slice(cursor, statement.pos));
    cursor = statement.end;
  }

  keep.push(text.slice(cursor));

  return { remainder: keep.join(""), names };
}

export type AnalyzeRenderImpactInput = {
  path: string;
  /** The file at the base commit. Null when it did not exist, or could not be read. */
  baseText: string | null;
  /** The file at the prepared commit. Null when it could not be read. */
  headText: string | null;
};

/**
 * Whether this file's change provably cannot alter rendered output.
 *
 * Pure and total: two strings in, one verdict out. Every failure resolves to
 * `unproven`, which the caller reads as "keep the path-based answer".
 */
export function analyzeRenderImpact(input: AnalyzeRenderImpactInput): RenderImpactVerdict {
  if (!isRenderImpactCandidate(input.path)) return unproven("not_a_route_segment");
  if (input.headText === null) return unproven("content_unavailable");

  // A new page is visible, and a failed base read proves nothing. The two are
  // indistinguishable from here — and they want the same answer, so the
  // ambiguity costs nothing.
  if (input.baseText === null) return unproven("no_base_version");

  if (
    input.baseText.length > RENDER_IMPACT_LIMITS.maxBytesPerFile ||
    input.headText.length > RENDER_IMPACT_LIMITS.maxBytesPerFile
  ) {
    return unproven("content_unavailable");
  }

  const base = strip(input.path, normalizeLineEndings(input.baseText));
  const head = strip(input.path, normalizeLineEndings(input.headText));
  if (base === null || head === null) return unproven("unparseable");

  if (base.remainder.trim() !== head.remainder.trim()) return unproven("render_path_changed");

  // Identical remainders with nothing stripped would mean the file did not
  // change at all — not this module's business, and not a claim worth making.
  const strippedExports = [...new Set([...base.names, ...head.names])].sort();
  if (strippedExports.length === 0) return unproven("render_path_changed");

  return { kind: "no_render_impact", strippedExports };
}
