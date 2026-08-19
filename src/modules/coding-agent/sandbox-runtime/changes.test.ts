import { describe, expect, it } from "vitest";
import { fakeSandboxProvider, type FakeSandboxOptions } from "@/modules/validation/test-support";
import {
  captureWorkspaceBaseline,
  discoverWorkspaceChanges,
  listWorkspaceFiles,
  MAX_WORKSPACE_PATHS,
  plantChangeMarker,
  readWorkspaceBaseline,
} from "./changes";

/**
 * What the run changed, established by looking rather than by asking.
 *
 * The in-process topology could ask the tool gateway, because every write went
 * through it. This one cannot: the agent edits files itself inside the VM. So
 * the property under test is that Vibe's answer comes from two filesystem
 * observations and a marker — never from anything the model said.
 */

const MARKER = "/vercel/sandbox/.vibe-agent/marker";

const LIST = "find . ( -name node_modules -o -name .git -o -name .next -o -name dist -o -name build -o -name .turbo -o -name .vercel -o -name coverage ) -prune -o -type f -printf %P\n";
const TOUCHED = `find . ( -name node_modules -o -name .git -o -name .next -o -name dist -o -name build -o -name .turbo -o -name .vercel -o -name coverage ) -prune -o -type f -newer ${MARKER} -printf %P\n`;

async function handle(options: FakeSandboxOptions = {}) {
  const provider = fakeSandboxProvider(options);
  const sandbox = await provider.create({
    name: "agent-run-1",
    source: { kind: "git", repositoryUrl: "https://github.test/o/r", revision: "abc", credential: null },
    networkPolicy: { mode: "deny_all" },
    timeoutMs: 60_000,
    env: {},
  });
  return { provider, sandbox };
}

function lines(...paths: string[]) {
  return { exitCode: 0, output: `${paths.join("\n")}\n` };
}

async function changes(after: string[], touched: string[], before: string[]) {
  const { sandbox } = await handle({
    results: { [LIST]: lines(...after), [TOUCHED]: lines(...touched) },
  });

  return discoverWorkspaceChanges({
    sandbox,
    cwd: "repo",
    before: { paths: new Set(before), truncated: false },
    markerPath: MARKER,
  });
}

describe("the three ways a workspace differs", () => {
  it("finds a file the agent created", async () => {
    const result = await changes(["app/page.tsx", "app/robots.ts"], ["app/robots.ts"], ["app/page.tsx"]);

    expect(result.paths).toEqual(["app/robots.ts"]);
  });

  it("finds a file the agent edited", async () => {
    const result = await changes(["app/page.tsx"], ["app/page.tsx"], ["app/page.tsx"]);

    expect(result.paths).toEqual(["app/page.tsx"]);
  });

  it("finds a file the agent deleted", async () => {
    const result = await changes(["app/page.tsx"], [], ["app/page.tsx", "app/old.tsx"]);

    expect(result.paths).toEqual(["app/old.tsx"]);
  });

  /**
   * The point of the marker. A file the agent read and thought about is not a
   * change, however much its account of the run says otherwise.
   */
  it("reports nothing for a file that was only read", async () => {
    const result = await changes(["app/page.tsx"], [], ["app/page.tsx"]);

    expect(result.paths).toEqual([]);
  });

  it("returns a sorted, deduplicated set", async () => {
    const result = await changes(
      ["z.ts", "a.ts", "m.ts"],
      ["z.ts", "a.ts", "m.ts"],
      ["z.ts", "a.ts", "m.ts"],
    );

    expect(result.paths).toEqual(["a.ts", "m.ts", "z.ts"]);
  });
});

describe("what the walk never descends into", () => {
  it("prunes install trees and build output rather than filtering them", async () => {
    const { provider, sandbox } = await handle({ results: { [LIST]: lines("app/page.tsx") } });

    await listWorkspaceFiles({ sandbox, cwd: "repo" });

    const walk = provider.commands().find((command) => command.startsWith("find "));
    // `-prune`, not a `-not -path` filter: the difference is whether hundreds
    // of thousands of `node_modules` entries get walked at all (Rule 27).
    expect(walk).toContain("-prune");
    for (const directory of ["node_modules", ".git", ".next", "dist", "coverage"]) {
      expect(walk).toContain(`-name ${directory}`);
    }
  });
});

describe("an observation that might be incomplete", () => {
  /**
   * "We found these files" and "these are the files" are different claims, and
   * only the second may become a diff a person is asked to approve.
   */
  it("is truncated when a listing hits the cap", async () => {
    const many = Array.from({ length: MAX_WORKSPACE_PATHS + 10 }, (_, index) => `f${index}.ts`);
    const result = await changes(many, [], []);

    expect(result.truncated).toBe(true);
  });

  it("is truncated when the walk failed rather than reporting an empty workspace", async () => {
    const { sandbox } = await handle({ defaultExitCode: 1 });

    const listing = await listWorkspaceFiles({ sandbox, cwd: "repo" });

    expect(listing).toEqual({ paths: new Set(), truncated: true });
  });

  it("carries a truncated baseline forward", async () => {
    const { sandbox } = await handle({ results: { [LIST]: lines("a.ts"), [TOUCHED]: lines() } });

    const result = await discoverWorkspaceChanges({
      sandbox,
      cwd: "repo",
      before: { paths: new Set(["a.ts"]), truncated: true },
      markerPath: MARKER,
    });

    expect(result.truncated).toBe(true);
  });
});

/**
 * The baseline, and the bug it shipped with.
 *
 * The first real agent run failed six seconds in with
 * `agent_workspace_unavailable`. The cause was not the sandbox: the baseline
 * was captured by joining `pruneExpression()` into a `sh -c` line, and those
 * tokens are written for an argument array — so `(` and `)` arrived at the
 * shell unquoted and `find` never ran. The tests passed because the fake parsed
 * the redirect and never looked at the command in front of it.
 *
 * Both halves are covered here: the baseline round-trips through the sandbox,
 * and no shell is asked to parse a command Vibe assembled.
 */
describe("the baseline listing", () => {
  it("round-trips through the sandbox", async () => {
    const { sandbox } = await handle({
      files: { "repo/app/page.tsx": "x", "repo/app/robots.ts": "y", "repo/node_modules/dep/i.js": "z" },
    });

    const captured = await captureWorkspaceBaseline({
      sandbox,
      cwd: "repo",
      baselinePath: "/vercel/sandbox/.vibe-agent/baseline",
    });
    expect(captured).toBe(true);

    const read = await readWorkspaceBaseline({
      sandbox,
      baselinePath: "/vercel/sandbox/.vibe-agent/baseline",
    });

    // Pruned directories are absent, so a later listing does not report an
    // install tree as newly added.
    expect(read?.paths).toEqual(new Set(["app/page.tsx", "app/robots.ts"]));
    expect(read?.truncated).toBe(false);
  });

  it("never hands an assembled command line to a shell", async () => {
    const { provider, sandbox } = await handle({ files: { "repo/a.ts": "x" } });

    await captureWorkspaceBaseline({
      sandbox,
      cwd: "repo",
      baselinePath: "/vercel/sandbox/.vibe-agent/baseline",
    });

    // The one legitimate `sh -c` is the here-document that writes bytes over
    // stdin. A `find` on a shell line is the defect this test exists for: its
    // prune tokens are argv-safe and shell-hostile at the same time.
    for (const command of provider.commands()) {
      if (!command.startsWith("sh -c ")) continue;
      expect(command).toContain("base64 -d");
      expect(command).not.toContain("find ");
    }
  });

  /**
   * A baseline that is missing files makes every one of them look newly added.
   * No baseline at all is the safer of the two failures, and the caller already
   * treats it as the workspace being unavailable.
   */
  it("refuses to write a truncated listing", async () => {
    const { sandbox } = await handle({ defaultExitCode: 1 });

    const captured = await captureWorkspaceBaseline({
      sandbox,
      cwd: "repo",
      baselinePath: "/vercel/sandbox/.vibe-agent/baseline",
    });

    expect(captured).toBe(false);
  });
});

describe("the marker", () => {
  it("is planted outside the repository, so it is never itself a change", async () => {
    const { provider, sandbox } = await handle();

    expect(await plantChangeMarker({ sandbox, markerPath: MARKER })).toBe(true);
    expect(provider.commands()).toContain(`touch -- ${MARKER}`);

    const planted = provider.events.find(
      (event) => event.kind === "command" && event.command.startsWith("touch "),
    );
    expect(planted?.kind === "command" && planted.cwd).toBe(".");
  });
});
