import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sprint 0081 — `ProjectScripts` is orientation, and never a command source.
 *
 * ## The finding this protects
 *
 * The ROADMAP entry that prompted this sprint read `package.json` scripts are
 * parsed and discarded, then re-parsed inside the sandbox in two places — with
 * the re-parse named as part of the defect. Traced against the code, it is not:
 *
 *  - `validation/orchestrator.ts` re-reads the manifest in every phase on
 *    purpose, and its own docblock says why — the plan must come from the
 *    filesystem the command is about to run against, never from a snapshot of
 *    an earlier invocation's belief about it.
 *  - `operations/agent-execution/execution.ts` does the same before building
 *    the gateway's check commands.
 *  - Rule 52 forbids carrying raw untrusted manifest text across a durable step
 *    boundary in any case, so the alternative is not available even in principle.
 *
 * So the entry's implied fix — put the scripts in the snapshot so the sandbox
 * need not read them — would have installed a *second* source of truth for what
 * a repository can do, and the two would eventually disagree: a snapshot is
 * pinned to one commit, and the sandbox holds whatever that commit's tree
 * actually contains after an install.
 *
 * The field shipped anyway, for a different job: telling a person, before they
 * pay for an agent run, that nothing in their repository will check its result
 * (rule 78). This file is what keeps those two jobs from merging back together.
 *
 * ## What is deliberately not asserted
 *
 * That the sandbox re-parse is *correct*. That is `validation/`'s own tests'
 * business. This asserts only that the snapshot field never becomes its input.
 */

const ROOT = process.cwd();

/** Every module that is allowed to construct a command Vibe will execute. */
const COMMAND_BUILDING_ROOTS = [
  "src/modules/validation",
  "src/modules/coding-agent",
  "src/modules/operations/agent-execution",
];

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const child = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [child] : [];
  });
}

const FILES = COMMAND_BUILDING_ROOTS.flatMap(sourceFiles);

/**
 * A read of `.scripts` off something that is a stored artefact rather than a
 * manifest just parsed from disk. `parsed.scripts` and `input.scripts` are the
 * correct reads and stay legal; `spec.repository.scripts` is the one this bans.
 */
const STORED_ARTEFACT_READ = /\b(snapshot|spec|analysis|intelligence)\w*(\.\w+)*\.scripts\b/i;

describe("a command is never built from the stored snapshot's script list", () => {
  it("finds the files it is supposed to be checking", () => {
    // The guard on the guard: a walk that silently found nothing would pass
    // every assertion below while covering none of them.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES.some((file) => file.endsWith("validation/orchestrator.ts"))).toBe(true);
    expect(FILES.some((file) => file.endsWith("agent-execution/execution.ts"))).toBe(true);
  });

  it("imports neither ProjectScripts nor ProjectScriptId anywhere that runs commands", () => {
    const importing = FILES.filter((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return /\bProjectScripts?\b|\bProjectScriptId\b/.test(source);
    });
    expect(
      importing,
      "A module that builds commands must derive them from the sandbox filesystem, " +
        "not from a snapshot's account of it — see this file's header",
    ).toEqual([]);
  });

  it("reads .scripts only off a freshly parsed manifest", () => {
    const offending = FILES.flatMap((file) => {
      const source = readFileSync(join(ROOT, file), "utf8");
      return STORED_ARTEFACT_READ.test(source) ? [relative(".", file)] : [];
    });
    expect(
      offending,
      "These read a script list off a stored artefact rather than off the manifest " +
        "the command is about to run against",
    ).toEqual([]);
  });
});
