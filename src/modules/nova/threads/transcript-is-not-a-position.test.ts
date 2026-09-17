import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Deleting every thread must change no canonical fact ([ADR 0109](../../../../docs/decisions/0109-nova-first-application-shell.md) §6).
 *
 * ## Why this is a test and not a rule in a document
 *
 * Because it erodes one import at a time, and every one of them looks
 * reasonable on its own. The ranking could "remember" that a founder dismissed
 * something. The briefing could "avoid repeating itself". The focus could skip
 * a moment it already mentioned. Each is a small convenience, and together they
 * are the *"transcript as source of truth"* the Nova architecture audit's §M
 * closed — at which point deleting a thread changes what the product believes.
 *
 * The rule has a precise shape: **nothing under `src/modules/nova/` outside
 * `threads/` may import the thread store or its read model.** Which leaves the
 * conversation free to *point at* canonical state and leaves canonical state
 * unable to see a conversation at all.
 *
 * ## Why `schema.ts` is not covered
 *
 * It holds unions and a table of sentences. A caller importing `MessageKind` is
 * not reading a founder's history; a caller importing `readThreadMessages` is.
 * The rule is about the reads, and drawing it around the file that *has* them
 * is what keeps it meaningful rather than merely wide.
 */

const NOVA = join(process.cwd(), "src", "modules", "nova");

/** The files that can put a message in front of a decision. */
const TRANSCRIPT_READS = ["threads/store", "threads/view"] as const;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) return [];
    if (entry.includes(".test.")) return [];
    return [full];
  });
}

/** Every non-test file under `src/modules/nova/`, outside `threads/`. */
function theRestOfNova(): string[] {
  return sourceFiles(NOVA).filter(
    (file) => !relative(NOVA, file).replaceAll("\\", "/").startsWith("threads/"),
  );
}

describe("the transcript is memory, and the domain is truth", () => {
  it("finds the files it is about", () => {
    // An empty set would pass every assertion below while proving nothing —
    // this repository has been caught by an empty-set pass before (Sprint 0119).
    const rest = theRestOfNova();
    expect(rest.length).toBeGreaterThan(10);
    expect(rest.map((file) => relative(NOVA, file))).toContain("focus.ts");
    expect(rest.map((file) => relative(NOVA, file))).toContain("read.ts");
  });

  it("lets nothing else in Nova read a message", () => {
    const offenders = theRestOfNova().filter((file) => {
      const source = readFileSync(file, "utf8");
      return TRANSCRIPT_READS.some((module) => source.includes(module));
    });

    expect(offenders.map((file) => relative(NOVA, file))).toEqual([]);
  });

  /**
   * The two that decide. `focus.ts` ranks what needs a founder now and `read.ts`
   * gathers the facts behind it; if either could see a turn, a conversation
   * would start deciding what the product believes is owed.
   */
  it.each(["focus.ts", "read.ts"])("keeps %s unable to see a thread at all", (file) => {
    const source = readFileSync(join(NOVA, file), "utf8");

    expect(source).not.toContain("nova_threads");
    expect(source).not.toContain("nova_messages");
    expect(source).not.toContain("./threads");
  });

  /**
   * And nothing writes canonical state from here. The store appends to two
   * tables and reads three columns off a third; a write to anything else would
   * be the transcript deciding something.
   */
  it("writes only to the two tables a transcript is made of", () => {
    const store = readFileSync(join(NOVA, "threads", "store.ts"), "utf8");
    const written = [...store.matchAll(/\.from\((\w+|"[^"]+")\)/g)].map((match) => match[1]);

    expect(new Set(written)).toEqual(new Set(["THREADS", "MESSAGES"]));
    expect(store).not.toContain("createServiceClient");
  });
});
