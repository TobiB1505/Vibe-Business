import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile as readFileFromDisk,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SandboxHandle } from "@/modules/validation/sandbox-port";
import {
  captureWorkspaceBaseline,
  discoverWorkspaceChanges,
  listWorkspaceFiles,
  plantChangeMarker,
  readWorkspaceBaseline,
} from "./changes";

/**
 * Vibe's own observation of a workspace, against a real filesystem (Rule 77).
 *
 * ## The four days this exists to prevent happening twice
 *
 * Sprint 0107 changed the listing to `find -printf "%P\0"` — a real NUL byte in
 * an argument — because a newline is a legal character in a filename and NUL is
 * the one byte that is not. The reasoning was right and the escape was wrong:
 * argv is a list of C strings, so an argument containing NUL cannot reach a
 * process at all. Node refuses to spawn, the provider reports the throw as a
 * failed command, and every agent run from 2026-08-28 died at its first
 * workspace listing, recorded as `sandbox_lost` with no detail.
 *
 * The whole suite stayed green for four days, because nothing between the fake
 * sandbox and production ever ran the command. The fake implements `find` as a
 * regular expression over the rendered string: it reads `-name` tokens and
 * never evaluates `-printf`, `%P`, `-prune` or `-type f` at all. It answers
 * with what the argument array is *supposed* to mean.
 *
 * So this runs the real thing. It is the canary lane's own argument — *"a test
 * that proves a boundary has to run the thing that enforces it"* — applied to
 * the boundary Rule 77 rests on.
 *
 * ## What it costs
 *
 * Nothing. No provider, no model, no sandbox, no network: a temp directory and
 * a few `find` invocations. It is the cheapest canary in the tree and the only
 * one that needs no stub server.
 *
 * ## What it deliberately does not do
 *
 * It does not re-test what `changes.test.ts` already covers — added, modified
 * and deleted, truncation, the marker's meaning. Those are decisions about
 * *sets*, and a fake is the right instrument for them. This covers only what a
 * fake structurally cannot answer: whether the commands Vibe sends are commands
 * an operating system accepts, and whether their output means what the parser
 * assumes.
 */

/**
 * The tools these commands are written against, checked rather than assumed.
 *
 * `-printf` and `%P` are GNU extensions and absent from BSD/macOS `find`;
 * `base64 -d` is the GNU spelling of what BSD calls `-D`. On a machine without
 * them this canary proves nothing, and the skip below says so out loud rather
 * than passing quietly.
 */
function gnuToolsAvailable(): boolean {
  const find = spawnSync("find", [".", "-maxdepth", "0", "-printf", "%P"], { cwd: tmpdir() });
  if (find.error || find.status !== 0) return false;

  const base64 = spawnSync("base64", ["-d"], { input: "" });
  return !base64.error && base64.status === 0;
}

/**
 * A sandbox that is this machine.
 *
 * Only `run` and `readFile` are reachable from the observation functions, and
 * the rest of `SandboxHandle` exists to satisfy the type. They throw rather
 * than returning a plausible value: if one of them is ever called from this
 * path, the failure should name itself instead of being modelled.
 */
function localSandbox(home: string): SandboxHandle {
  const unreachable = (name: string) => () => {
    throw new Error(`${name} is not part of the observation path`);
  };

  // Typed as the slice the observation path actually touches, so `run` and
  // `readFile` are contextually typed by the port rather than by a cast — a
  // canary whose fake drifts from the interface it stands in for is the same
  // failure this file exists to catch, one level up.
  const observable: Pick<SandboxHandle, "id" | "runtime" | "liveness" | "run" | "readFile"> = {
    id: "observation-canary",
    runtime: "local/node",
    liveness: "running",

    async run(input) {
      const startedAt = Date.now();
      // `cwd` arrives relative to the sandbox home, exactly as production
      // passes it (`workspaceCwdFor` yields "." or a repository sub-path).
      const cwd = isAbsolute(input.cwd) ? input.cwd : resolve(home, input.cwd);

      // What the provider does with a throw, and the reason this is a
      // `try`/`catch` and not a check of `result.error`: an argument containing
      // a NUL byte makes `spawnSync` *throw* rather than return, and
      // `vercel/provider.ts` turns any such throw into exit 1 carrying
      // `describeProviderError` — `${name}: ${message}`. A canary that let the
      // exception escape would report a crashed test where production reports a
      // failed command, and the two travel to completely different places.
      let result: ReturnType<typeof spawnSync>;
      try {
        result = spawnSync(input.command.command, input.command.args, {
          cwd,
          timeout: input.timeoutMs,
          maxBuffer: 32 * 1024 * 1024,
          ...(input.env ? { env: { ...process.env, ...input.env } } : {}),
        });
      } catch (error) {
        const thrown = error as Error;
        return {
          exitCode: 1,
          durationMs: Date.now() - startedAt,
          output: `${thrown.name}: ${thrown.message}`,
          timedOut: false,
        };
      }

      if (result.error) {
        const error = result.error as Error;
        return {
          exitCode: 1,
          durationMs: Date.now() - startedAt,
          output: `${error.name}: ${error.message}`,
          timedOut: false,
        };
      }

      // stdout then stderr, as `readOutput` in the Vercel adapter assembles it.
      // NUL bytes survive the conversion; they are ordinary code points.
      const stdout = result.stdout?.toString() ?? "";
      const stderr = result.stderr?.toString() ?? "";

      return {
        exitCode: result.status ?? 1,
        durationMs: Date.now() - startedAt,
        output: `${stdout}${stderr.length > 0 ? `\n${stderr}` : ""}`,
        timedOut: result.signal === "SIGTERM",
      };
    },

    async readFile(input) {
      const path = isAbsolute(input.path) ? input.path : resolve(home, input.path);
      try {
        const content = await readFileFromDisk(path, "utf8");
        return content.length > input.maxBytes ? content.slice(0, input.maxBytes) : content;
      } catch {
        return null;
      }
    },
  };

  return {
    ...observable,
    runBackground: unreachable("runBackground"),
    applyNetworkPolicy: unreachable("applyNetworkPolicy"),
    snapshot: unreachable("snapshot"),
    publicOrigin: unreachable("publicOrigin"),
    stop: unreachable("stop"),
  } as unknown as SandboxHandle;
}

/**
 * A workspace shaped like the ones that broke things.
 *
 * Every entry is here because some part of this module's history is about it:
 * the newline is why the delimiter is NUL, the symlink is why the walk says
 * `-type f`, and the pruned trees are why it says `-prune` rather than a filter.
 * `untouched.ts` is there so "changed" has something to exclude — a comparison
 * whose every input changed cannot tell a set difference from a listing.
 */
const NEWLINE_NAME = "src/we\nird.ts";

async function workspace(): Promise<{ home: string; cwd: string }> {
  const home = await mkdtemp(join(tmpdir(), "vibe-observation-canary-"));
  const repo = join(home, "repo");

  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(repo, ".git"), { recursive: true });

  await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n");
  await writeFile(join(repo, NEWLINE_NAME), "export const weird = 1;\n");
  await writeFile(join(repo, "src", "untouched.ts"), "export const untouched = 1;\n");
  await writeFile(join(repo, "node_modules", "pkg", "index.js"), "module.exports = {};\n");
  await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
  await symlink(join(repo, "src", "a.ts"), join(repo, "src", "link.ts"));

  return { home, cwd: "repo" };
}

const available = gnuToolsAvailable();
const canary = available ? describe : describe.skip;

canary("Vibe's observation, against a real filesystem", () => {
  it("lists the files a repository has, and nothing it only appears to", async () => {
    const { home, cwd } = await workspace();
    const listing = await listWorkspaceFiles({ sandbox: localSandbox(home), cwd });

    // The whole point of the NUL delimiter: a newline in a name is one path,
    // not two. Splitting on newlines produced `src/we` and `ird.ts`, and
    // neither of them is a file anybody touched.
    expect([...listing.paths].sort()).toEqual(["src/a.ts", "src/untouched.ts", NEWLINE_NAME]);

    // `-type f`, so the link never enters the observed set at all rather than
    // being caught later by a read that would already have followed it.
    expect(listing.paths.has("src/link.ts")).toBe(false);

    // `-prune`, so these are not walked — the difference between reading eight
    // paths and reading a hundred thousand (Rule 27).
    expect([...listing.paths].some((path) => path.startsWith("node_modules/"))).toBe(false);
    expect([...listing.paths].some((path) => path.startsWith(".git/"))).toBe(false);

    // An observation that might be incomplete is refused, not trimmed.
    expect(listing.truncated).toBe(false);

    await rm(home, { recursive: true, force: true });
  });

  it("writes a baseline it can read back byte for byte", async () => {
    const { home, cwd } = await workspace();
    const sandbox = localSandbox(home);
    const baselinePath = join(home, "baseline.txt");

    const captured = await captureWorkspaceBaseline({ sandbox, cwd, baselinePath });
    expect(captured).toEqual({ ok: true });

    const read = await readWorkspaceBaseline({ sandbox, baselinePath });
    // The round trip is the property: the file has to be written the way it
    // will be read, including for a name that contains a newline.
    expect(read?.truncated).toBe(false);
    expect([...(read?.paths ?? [])].sort()).toEqual([
      "src/a.ts",
      "src/untouched.ts",
      NEWLINE_NAME,
    ]);

    await rm(home, { recursive: true, force: true });
  });

  it("finds what changed after the marker, and only that", async () => {
    const { home, cwd } = await workspace();
    const sandbox = localSandbox(home);
    const repo = join(home, "repo");
    const markerPath = join(home, "marker");

    const before = await listWorkspaceFiles({ sandbox, cwd });
    expect(await plantChangeMarker({ sandbox, markerPath })).toEqual({ ok: true });

    // `-newer` compares two inodes on one filesystem, and a filesystem's
    // timestamp granularity is not this test's business — so make the edit
    // unambiguously later than the marker.
    await new Promise((done) => setTimeout(done, 1_100));
    await writeFile(join(repo, "src", "a.ts"), "export const a = 2;\n");
    await rm(join(repo, NEWLINE_NAME));

    const changes = await discoverWorkspaceChanges({ sandbox, cwd, before, markerPath });

    // One set, sorted: `-newer` found the edit, and the deletion arrives by set
    // difference against `before` because a file that is gone has no mtime to
    // compare. `WorkspaceChanges` deliberately carries no separate `deleted`
    // list — everything downstream asks "is this path as it was", not "how".
    expect(changes.paths).toEqual(["src/a.ts", NEWLINE_NAME]);

    // The file nobody touched is the assertion that matters: a listing would
    // have returned it too, and only a comparison leaves it out.
    expect(changes.paths).not.toContain("src/untouched.ts");
    expect(changes.truncated).toBe(false);

    await rm(home, { recursive: true, force: true });
  });
});

/**
 * A canary that quietly skips stops proving anything the moment an install or a
 * base image changes, so the skip is itself a reported result.
 */
describe.skipIf(available)("GNU find or base64 unavailable", () => {
  it("reports that the observation canary did not run", () => {
    expect(available).toBe(false);
  });
});
