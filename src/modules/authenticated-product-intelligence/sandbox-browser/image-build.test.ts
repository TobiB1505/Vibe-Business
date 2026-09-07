import { describe, expect, it } from "vitest";
import {
  BROWSER_PLAYWRIGHT_VERSION,
  IMAGE_BUILD_CWD,
  IMAGE_BUILD_HOSTS,
  imageBuildCommands,
} from "./image-build";
import { BROWSER_SANDBOX } from "./runtime";

/**
 * The build's two invariants, both written the day production disproved them.
 *
 * Neither is checkable from a unit test in the sense of "does the download
 * work" — that needs a real sandbox and a real network. What is checkable is
 * that the list and the commands still say what the two failures taught, so
 * that a tidy-up cannot quietly undo either.
 */

describe("the egress allowlist covers where the browser actually comes from", () => {
  /**
   * The entry with nothing in this repository pointing at it.
   *
   * `storage.googleapis.com` appears in no command, no URL and no import — it
   * is where an allowlisted host *redirects*. Somebody removing unreferenced
   * entries would take it, and the next scan would die at command 2 with
   * `getaddrinfo EAI_AGAIN`, which is exactly what happened before it was
   * added.
   */
  it("keeps the redirect target the CDN hands the download to", () => {
    expect(
      IMAGE_BUILD_HOSTS,
      "cdn.playwright.dev answers 307 to storage.googleapis.com for Chrome for Testing; " +
        "allowing only the name the build asks for is a DNS refusal on the name it fetches",
    ).toContain("storage.googleapis.com");
  });

  it("keeps the CDN itself, which is what the build asks for", () => {
    // Both halves are needed: the redirect target alone is never contacted,
    // and the CDN alone cannot complete a download.
    expect(IMAGE_BUILD_HOSTS).toContain("cdn.playwright.dev");
  });

  it("names hosts and never a scheme or a path", () => {
    // The provider matches host patterns. A URL here would silently match
    // nothing, which reads as an outage rather than as a typo.
    for (const host of IMAGE_BUILD_HOSTS) {
      expect(host).not.toContain("://");
      expect(host).not.toContain("/");
    }
  });
});

describe("the browser's system libraries are Playwright's problem, not ours", () => {
  /** The step that installs the libraries Chromium links against. */
  const depsStep = () =>
    imageBuildCommands().find((step) => step.command.args.includes("install-deps"));

  it("asks Playwright rather than naming packages", () => {
    // Two assumptions died here: that the sandbox is Amazon Linux (it answered
    // `dnf: command not found`) and that a hand-mapped package list is
    // checkable without running it. `install-deps` detects the distribution
    // and installs what the people who build the browser say it needs.
    const deps = depsStep();

    expect(deps, "chromium exits 127 without its shared libraries").toBeDefined();
    expect(deps?.command.command).toBe("npx");
  });

  it("pins the same release the driver and the browser come from", () => {
    expect(depsStep()?.command.args).toContain(`playwright@${BROWSER_PLAYWRIGHT_VERSION}`);
  });

  it("runs as root, because a package manager needs it", () => {
    expect(depsStep()?.sudo).toBe(true);
  });

  it("asks for root in exactly one step", () => {
    // The npm install and the browser download stay unprivileged, so the
    // browser is owned by the user that runs it rather than by root.
    const elevated = imageBuildCommands().filter((step) => step.sudo);

    expect(elevated).toHaveLength(1);
    expect(elevated[0]?.command.args).toContain("install-deps");
  });

  it("can reach a package archive whichever distribution this turns out to be", () => {
    // Vercel documents its *build* image as Amazon Linux and publishes
    // `universal`, `node:24` and `ubuntu` sandbox images without saying what
    // `universal` is. All three families are named rather than one guessed at.
    for (const host of ["cdn.amazonlinux.com", "deb.debian.org", "archive.ubuntu.com"]) {
      expect(IMAGE_BUILD_HOSTS).toContain(host);
    }
  });
});

describe("the build makes its own root before it needs one", () => {
  it("creates the root in its first command", () => {
    const [first] = imageBuildCommands();

    expect(first.command.command).toBe("mkdir");
    expect(first.command.args).toContain(BROWSER_SANDBOX.root);
  });

  it("does not run that command inside the directory it creates", () => {
    // `chdir /vibe-browser: no such file or directory` — the first real Deep
    // Scan. This sandbox has no git source, so nothing exists before the build
    // says so.
    expect(IMAGE_BUILD_CWD).not.toBe(BROWSER_SANDBOX.root);
    expect(IMAGE_BUILD_CWD).toBe("/");
  });

  it("installs the browser at the version the driver is pinned to", () => {
    // Both halves are one release: the Chromium inside the sandbox and the
    // playwright-core that drives it from Vibe's server.
    const install = imageBuildCommands().find((step) => step.command.command === "npx");

    expect(install?.command.args).toContain(`playwright@${BROWSER_PLAYWRIGHT_VERSION}`);
  });
});
