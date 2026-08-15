import { createHash } from "node:crypto";
import type { ResolvedMetadataValues } from "../metadata-detection";

/**
 * The metadata foundations generator (Sprint 13A.1 §10, §24).
 *
 * ## Why this edits rather than creates
 *
 * The SEO generator writes two files that did not exist. This one changes a
 * file the customer owns, which is a different and more dangerous shape: the
 * failure mode is not "an unwanted file appears" but "their layout is
 * rewritten".
 *
 * So the edit is the narrowest one that can work — the existing `metadata`
 * export gains an `openGraph` block, and nothing else in the file is touched.
 * No reformatting, no import reordering, no "while we're here".
 *
 * ## Why the values are serialized rather than interpolated
 *
 * Because a product title is customer text and this output is **code**. A title
 * containing a quote, a backtick, a newline or `"; process.exit()` must produce
 * a valid string literal, not a syntax error and certainly not an expression.
 *
 * `JSON.stringify` is the serializer for exactly this reason: it is a
 * total function from any JavaScript string to a valid JS string literal, and
 * it escapes quotes, backslashes and control characters by construction. Hand
 * rolling the escaping is how injection bugs are written.
 */

export type MetadataGeneratorInput = {
  /** The file holding the framework-served metadata export. */
  filePath: string;
  /** The file's current contents. Preserved except for the metadata block. */
  source: string;
  values: ResolvedMetadataValues;
};

export type GeneratedFile = {
  path: string;
  content: string;
  contentHash: string;
  bytes: number;
};

export type GenerationResult =
  | { ok: true; files: GeneratedFile[] }
  /**
   * The generator refused rather than guessed.
   *
   * A deterministic editor that cannot find what it expects must stop. Editing
   * "roughly where the metadata seems to be" is how a layout gets corrupted.
   */
  | { ok: false; error: "metadata_export_not_found" | "already_present" };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Serializes a customer string as a JavaScript string literal.
 *
 * Everything hostile is handled by `JSON.stringify` itself: quotes, backslashes,
 * newlines and control characters. The only addition is escaping `</` so a value
 * containing `</script>` cannot terminate a script context if this source is
 * ever inlined somewhere it should not be.
 */
function literal(value: string): string {
  return JSON.stringify(value).replace(/<\//g, "<\\/");
}

/**
 * Builds the `openGraph` block from resolved trusted values.
 *
 * Only fields with trusted values appear. `og:url` and `siteName` are omitted
 * entirely when unknown rather than emitted empty — an empty `og:url` is worse
 * than none, because it looks like an answer.
 */
function openGraphBlock(values: ResolvedMetadataValues, indent: string): string {
  const lines = [
    `${indent}openGraph: {`,
    `${indent}  title: ${literal(values.title)},`,
    `${indent}  description: ${literal(values.description)},`,
    `${indent}  type: "website",`,
  ];

  if (values.siteName) lines.push(`${indent}  siteName: ${literal(values.siteName)},`);
  if (values.ogUrl) lines.push(`${indent}  url: ${literal(values.ogUrl)},`);

  lines.push(`${indent}},`);
  return lines.join("\n");
}

/**
 * Adds the missing Open Graph block to an existing metadata export.
 *
 * ## What it deliberately does not do
 *
 * Touch `title` or `description`. They are read to build the Open Graph values
 * — so the social preview says the same thing the page does — but the existing
 * declarations are left exactly as the customer wrote them, byte for byte.
 * That is the invariant §5 calls hard, and it is why this inserts a block
 * rather than rewriting the object.
 */
export function generateMetadataFoundations(
  input: MetadataGeneratorInput,
): GenerationResult {
  const { source } = input;

  // Anchored on the framework's own export, not on "an object that looks like
  // metadata". If this is not found, the file is not the shape the detector
  // said it was and the generator stops.
  const exportMatch = source.match(/export const metadata\s*:\s*Metadata\s*=\s*\{/);
  if (!exportMatch || exportMatch.index === undefined) {
    return { ok: false, error: "metadata_export_not_found" };
  }

  // Never add a second `openGraph` key: two would be a syntax-valid file whose
  // later key silently wins, which is worse than refusing.
  const openBrace = exportMatch.index + exportMatch[0].length;
  const closeBrace = source.indexOf("\n};", openBrace);
  if (closeBrace === -1) return { ok: false, error: "metadata_export_not_found" };

  const body = source.slice(openBrace, closeBrace);
  if (/\bopenGraph\s*:/.test(body)) return { ok: false, error: "already_present" };

  // Match the file's own indentation rather than imposing a style. A diff that
  // reformats is a diff a reviewer has to read twice.
  const indentMatch = body.match(/\n([ \t]+)\S/);
  const indent = indentMatch ? indentMatch[1] : "  ";

  const content =
    source.slice(0, closeBrace) +
    "\n" +
    openGraphBlock(input.values, indent) +
    source.slice(closeBrace);

  return {
    ok: true,
    files: [
      {
        path: input.filePath,
        content,
        contentHash: sha256(content),
        bytes: Buffer.byteLength(content, "utf8"),
      },
    ],
  };
}
