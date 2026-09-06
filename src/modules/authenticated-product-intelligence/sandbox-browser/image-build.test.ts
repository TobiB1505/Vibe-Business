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

describe("the build makes its own root before it needs one", () => {
  it("creates the root in its first command", () => {
    const [first] = imageBuildCommands();

    expect(first.command).toBe("mkdir");
    expect(first.args).toContain(BROWSER_SANDBOX.root);
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
    const install = imageBuildCommands().find((command) => command.command === "npx");

    expect(install?.args).toContain(`playwright@${BROWSER_PLAYWRIGHT_VERSION}`);
  });
});
