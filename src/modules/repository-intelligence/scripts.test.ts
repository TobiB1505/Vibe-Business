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

/**
 * The same boundary, for the fact Stufe 4 added.
 *
 * `BuildIntelligence.buildScript` says a manifest *declared* a build script at
 * the analyzed commit. That is the same kind of claim `ProjectScripts` makes,
 * and it would be the same defect if a command were built from it — so it is
 * banned in the same places, with one recorded exception.
 *
 * ## Why an allowlist rather than a ban
 *
 * `validation/profile.ts` decides **admission**: whether Vibe should buy a
 * sandbox for this repository at all. It builds no command, and it has to read
 * this — nothing else in the snapshot can distinguish "there is a buildable
 * application in `frontend/`" from "there is one at the root", which is the
 * question a working directory is the answer to.
 *
 * The list below is the review record, in the shape `REVIEWED_SITES` uses in
 * `src/lib/supabase/service-boundary.test.ts`. A second entry needs a reviewer,
 * which is the property this file exists to keep.
 */
const BUILD_INTELLIGENCE_READERS: Record<string, string> = {
  "src/modules/validation/profile.ts":
    "Decides admission, not commands. Reads build targets to answer 'is there exactly " +
    "one installable application, and where?' — a question no other snapshot field can " +
    "answer, and one the sandbox cannot be asked before it has been paid for. What " +
    "actually runs is still re-derived from the sandbox's own filesystem in every phase.",
};

describe("a command is never built from the stored snapshot's build targets", () => {
  const READ =
    /\bBuildIntelligence\b|\bBuildTarget\b|\b\w*(snapshot|spec|analysis|intelligence)\w*(\.\w+)*\.build\b/i;

  it("is read in exactly the reviewed places, and nowhere else", () => {
    const offending = FILES.filter((file) => {
      if (BUILD_INTELLIGENCE_READERS[relative(".", file)]) return false;
      // Fixtures build snapshots, not commands. `test-support.ts` escapes the
      // `.test.ts` filter above by name only, and excluding it here keeps this
      // guard about the production surface it was written for.
      if (file.endsWith("/test-support.ts")) return false;
      return READ.test(readFileSync(join(ROOT, file), "utf8"));
    }).map((file) => relative(".", file));

    expect(
      offending,
      "A module that builds commands must not read the snapshot's build targets. " +
        "If a new site genuinely needs them, add it to BUILD_INTELLIGENCE_READERS " +
        "with the argument — that list is the review record.",
    ).toEqual([]);
  });

  it("keeps every reviewed entry pointing at a file that exists and still reads it", () => {
    // An allowlist that outlives its reason is worse than no allowlist: it
    // reads as a reviewed exception when it is really a leftover.
    for (const [file, why] of Object.entries(BUILD_INTELLIGENCE_READERS)) {
      expect(FILES.map((candidate) => relative(".", candidate))).toContain(file);
      expect(READ.test(readFileSync(join(ROOT, file), "utf8"))).toBe(true);
      expect(why.length).toBeGreaterThan(120);
    }
  });
});
