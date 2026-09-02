import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sleep } from "./sleep";

/**
 * Two functions named `sleep`, and the one rule that keeps them apart.
 *
 * `import { sleep } from "workflow"` suspends a durable run: the step returns,
 * the function stops being billed, and the platform resumes later. The one in
 * this directory holds the process open for the whole duration.
 *
 * Swapping them is not a type error and breaks no test. Using this one inside
 * a `"use workflow"` body keeps a Node function alive through every poll of a
 * run that may last twenty-five minutes — a real invoice for time spent doing
 * nothing, and invisible in every check a change goes through.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string = SRC, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Compiler output, not authored here.
      if (entry.name === ".well-known") continue;
      sourceFiles(path, found);
      continue;
    }
    if ([".ts", ".tsx"].includes(extname(entry.name)) && !entry.name.includes(".test.")) {
      found.push(path);
    }
  }
  return found;
}

describe("sleep", () => {
  it("resolves after the timer, and only then", async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const waiting = sleep(1_000).then(() => {
        done = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(done).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await waiting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the two sleeps", () => {
  it("finds the files it is asserting about", () => {
    expect(sourceFiles().length).toBeGreaterThan(200);
  });

  /**
   * A workflow body that blocks is the expensive direction, so it is the one
   * asserted: a file carrying `"use workflow"` or `"use step"` may take its
   * `sleep` from the platform and from nowhere else.
   */
  it("keeps the blocking one out of every durable body", () => {
    const offenders = sourceFiles()
      .filter((path) => {
        const code = readFileSync(path, "utf8");
        const durable = code.includes('"use workflow"') || code.includes('"use step"');
        return durable && code.includes("@/lib/async/sleep");
      })
      .map((path) => relative(SRC, path));

    expect(
      offenders,
      "a durable body that blocks holds a function open instead of suspending",
    ).toEqual([]);
  });

  /**
   * And the other direction, which is merely useless rather than expensive:
   * outside a durable body the platform's `sleep` is not the function anybody
   * means.
   */
  it("keeps the suspending one inside durable bodies", () => {
    const offenders = sourceFiles()
      .filter((path) => {
        const code = readFileSync(path, "utf8");
        if (!/from "workflow"/.test(code)) return false;
        if (!/\bsleep\b/.test(code)) return false;
        return !(code.includes('"use workflow"') || code.includes('"use step"'));
      })
      .map((path) => relative(SRC, path));

    expect(offenders).toEqual([]);
  });
});
