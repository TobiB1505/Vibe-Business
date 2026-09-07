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

describe("the browser's system libraries are installed, not assumed", () => {
  it("installs them as root, because a package manager needs it", () => {
    const install = imageBuildCommands().find((step) => step.command.command === "dnf");

    expect(install, "chromium exits 127 without its shared libraries").toBeDefined();
    expect(install?.sudo).toBe(true);
  });

  it("names the library the loader actually asked for", () => {
    // `libglib-2.0.so.0: cannot open shared object file` — the fifth failure of
    // the first real Deep Scan, and `glib2` is the package that provides it.
    const install = imageBuildCommands().find((step) => step.command.command === "dnf");

    expect(install?.command.args).toContain("glib2");
  });

  it("carries a font, so a login page is readable rather than boxes", () => {
    // From Playwright's own `tools` list. A browser with no font renders a
    // sign-in form nobody can complete, which is a working Deep Scan that
    // fails for a reason no error would explain.
    const install = imageBuildCommands().find((step) => step.command.command === "dnf");

    expect(install?.command.args).toContain("liberation-fonts");
  });

  it("can reach the repository those packages come from", () => {
    // Measured: the AL2023 mirror list answers with URLs on this same host, so
    // one name is the whole requirement and no wildcard is needed.
    expect(IMAGE_BUILD_HOSTS).toContain("cdn.amazonlinux.com");
  });

  it("asks for root in exactly one step", () => {
    // The npm install and the browser download must not run as root: `dnf` is
    // the only command here that needs it, and `sudo-scope.test.ts` is why the
    // option exists at all.
    const elevated = imageBuildCommands().filter((step) => step.sudo);

    expect(elevated).toHaveLength(1);
    expect(elevated[0]?.command.command).toBe("dnf");
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
