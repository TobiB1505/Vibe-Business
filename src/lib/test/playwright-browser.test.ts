import { describe, expect, it } from "vitest";

import { resolveChromiumExecutable } from "./playwright-browser";

const nothingExists = () => false;
const only =
  (...paths: string[]) =>
  (path: string) =>
    paths.includes(path);

describe("resolveChromiumExecutable", () => {
  it("leaves Playwright alone when the browser it asked for is installed", () => {
    // The invariant that matters: on a runner that ran `playwright install`,
    // this must never substitute anything. A fallback preferred here would
    // pin whatever else the image happens to carry, in CI, invisibly.
    expect(
      resolveChromiumExecutable({
        registryPath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
        named: "/somewhere/else/chrome",
        browsersRoot: "/opt/pw-browsers",
        exists: only(
          "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
          "/somewhere/else/chrome",
          "/opt/pw-browsers/chromium",
        ),
      }),
    ).toBeUndefined();
  });

  it("names the image's browser when the registry's version is absent", () => {
    expect(
      resolveChromiumExecutable({
        registryPath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
        browsersRoot: "/opt/pw-browsers",
        exists: only("/opt/pw-browsers/chromium"),
      }),
    ).toBe("/opt/pw-browsers/chromium");
  });

  it("prefers an explicitly named executable over the conventional one", () => {
    expect(
      resolveChromiumExecutable({
        registryPath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
        named: "/usr/bin/chromium",
        browsersRoot: "/opt/pw-browsers",
        exists: only("/usr/bin/chromium", "/opt/pw-browsers/chromium"),
      }),
    ).toBe("/usr/bin/chromium");
  });

  it("ignores a named executable that is not there", () => {
    expect(
      resolveChromiumExecutable({
        registryPath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
        named: "/usr/bin/nothing",
        browsersRoot: "/opt/pw-browsers",
        exists: only("/opt/pw-browsers/chromium"),
      }),
    ).toBe("/opt/pw-browsers/chromium");
  });

  it("stays silent when no candidate exists, so Playwright reports its own error", () => {
    expect(
      resolveChromiumExecutable({
        registryPath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome",
        browsersRoot: "/opt/pw-browsers",
        exists: nothingExists,
      }),
    ).toBeUndefined();
  });

  it("still resolves when the registry cannot say what it wants", () => {
    // `executablePath()` throws on some misconfigurations rather than
    // returning a path. A thrown lookup is the same situation as a missing
    // one, not a reason to give up on running the suite.
    expect(
      resolveChromiumExecutable({
        registryPath: null,
        browsersRoot: "/opt/pw-browsers",
        exists: only("/opt/pw-browsers/chromium"),
      }),
    ).toBe("/opt/pw-browsers/chromium");
  });

  it("has nothing to offer without a browsers root", () => {
    expect(
      resolveChromiumExecutable({
        registryPath: null,
        exists: only("/opt/pw-browsers/chromium"),
      }),
    ).toBeUndefined();
  });
});
