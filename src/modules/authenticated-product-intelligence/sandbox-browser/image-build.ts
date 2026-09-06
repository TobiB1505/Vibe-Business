import type { SandboxCommand } from "@/modules/validation/commands";
import { BROWSER_SANDBOX } from "./runtime";

/**
 * How a browser runtime image is built (ADR 0076).
 *
 * Separate from the provider because building one and using one are different
 * operations with different needs: a build wants a package registry, minutes
 * rather than seconds, and it happens once for many sessions.
 *
 * ## The two egress windows
 *
 * The same separation ADR 0029 draws for the agent. A build reaches a registry
 * and a browser CDN; a *session* never does — by the time a person signs in,
 * the image is a snapshot and the packages are already on disk. So the wide
 * policy a session runs under (`allow_all`, because a login's destinations
 * cannot be enumerated) is not the policy a download runs under, and neither
 * window is widened to cover the other.
 *
 * ## Why the browser is fetched by Playwright rather than by URL
 *
 * A pinned CDN URL would be more obviously deterministic and is the wrong
 * trade: the build number in it belongs to Playwright's release, not to ours,
 * and hardcoding one means this file is silently wrong the first time it moves.
 * `playwright install chromium` at a pinned Playwright version resolves the
 * matching build itself, which is the same determinism expressed where it is
 * maintained.
 *
 * The version is pinned to the one this repository already depends on, so the
 * browser inside the sandbox and the `playwright-core` that drives it from
 * Vibe's server are from the same release rather than from whatever was newest
 * on the day of the build.
 */

/** Matches `playwright-core` in package.json. Both halves must be one release. */
export const BROWSER_PLAYWRIGHT_VERSION = "1.62.1";

/** Where npm puts the guard's dependency and Playwright's browsers. */
const BROWSERS_DIR = `${BROWSER_SANDBOX.root}/browsers`;

/**
 * Where the build's commands run, and why it is not the directory they build.
 *
 * `/`, not `BROWSER_SANDBOX.root`, and this constant exists so the reason
 * survives.
 *
 * The first real Deep Scan failed here, at command 0, after 3.8 seconds:
 *
 * ```
 * failed to start process: chdir /vibe-browser: no such file or directory
 * ```
 *
 * That command is the `mkdir -p` which **creates** `/vibe-browser`, and it was
 * being started with `/vibe-browser` as its working directory. A process cannot
 * `chdir` into a directory that does not exist yet, so the command whose whole
 * job is to create the root could never run.
 *
 * It is specific to this sandbox, which is what hid it. A validation or preview
 * sandbox is created from a **git source**, and the clone makes the working
 * directory before any command runs. This one is `{ kind: "image" }` — no
 * clone, no source, nothing on the filesystem but the base image — so the
 * directory has to be made, and the making cannot happen inside itself.
 *
 * Every build command addresses its target absolutely (`mkdir -p` the root,
 * `npm install --prefix` it, `PLAYWRIGHT_BROWSERS_PATH` under it, `node` with
 * the program's full path), so none of them needs a working directory at all.
 * `/` is simply somewhere that is certain to exist.
 */
export const IMAGE_BUILD_CWD = "/";

/**
 * The commands that build the image, in the order they run.
 *
 * Every one is Vibe-constructed as `{ command, args[] }` and never a string a
 * shell parses — the same rule as `validation/commands.ts`, for the same
 * reason. There is no interpolation point here that anything outside this file
 * can reach.
 */
export function imageBuildCommands(): readonly SandboxCommand[] {
  return [
    { command: "mkdir", args: ["-p", BROWSER_SANDBOX.root, BROWSERS_DIR] },
    // The guard's one dependency. `--ignore-scripts` for the same reason
    // validation installs that way: a lifecycle hook is the classic
    // supply-chain execution point, and this is the window with the network
    // open.
    {
      command: "npm",
      args: [
        "install",
        "--prefix",
        BROWSER_SANDBOX.root,
        "--no-save",
        "--ignore-scripts",
        "ws@8.18.0",
        `playwright-core@${BROWSER_PLAYWRIGHT_VERSION}`,
      ],
    },
    // Chromium. `install` is the one place a lifecycle-style download is the
    // point rather than a hazard, and it is Playwright's own, at a pinned
    // version, into a directory Vibe named.
    {
      command: "npx",
      args: ["--yes", `playwright@${BROWSER_PLAYWRIGHT_VERSION}`, "install", "chromium"],
    },
  ];
}

/**
 * The environment the build commands run under.
 *
 * `PLAYWRIGHT_BROWSERS_PATH` so the download lands somewhere the snapshot will
 * carry, rather than in a home-directory cache that a restored snapshot may not
 * reproduce.
 */
export function imageBuildEnv(): Record<string, string> {
  return { PLAYWRIGHT_BROWSERS_PATH: BROWSERS_DIR };
}

/**
 * Hosts a build may reach, and nothing else.
 *
 * Narrow because it can be: a build knows exactly where it is going, which is
 * the property a *session* does not have and the reason the two windows are
 * separate.
 */
export const IMAGE_BUILD_HOSTS = [
  // `npm install`, and `npx --yes playwright@…` fetching the installer itself.
  "registry.npmjs.org",
  "*.npmjs.org",
  // Playwright's three CDN mirrors, as `PLAYWRIGHT_CDN_MIRRORS` lists them in
  // the pinned release. Two names, because the second is the first's origin.
  "cdn.playwright.dev",
  "playwright.download.prss.microsoft.com",
  "*.blob.core.windows.net",
  /*
   * Where the browser actually comes from, which is not where it is asked for.
   *
   * The second real Deep Scan died here, on command 2, with
   * `getaddrinfo EAI_AGAIN storage.googleapis.com` — a DNS refusal, because an
   * allowlisted host answered with a redirect to one that was not.
   *
   * Measured rather than assumed, 2026-09-06:
   *
   *     HEAD https://cdn.playwright.dev/dbazure/download/playwright/…
   *     307 → https://storage.googleapis.com/chrome-for-testing-public/…
   *                                          /143.0.7499.4/linux64/chrome-linux64.zip
   *
   * Playwright's `chromium` on linux-x64 is Chrome for Testing, and Chrome for
   * Testing is published to a Google Cloud Storage bucket. The CDN is a front
   * for it. `*.blob.core.windows.net` above is the same shape one cloud over —
   * the ESRP mirror's own redirect target — so the list already knew redirect
   * targets belong in it and simply had the wrong one.
   *
   * Nothing in this repository references this host, so it reads like a stray
   * entry. `image-build.test.ts` is what stops it being tidied away.
   */
  "storage.googleapis.com",
] as const;

/**
 * The program that pins Chromium's path, run after the download.
 *
 * ## Why a program rather than a command
 *
 * Playwright installs into a revision-numbered directory — `chromium-1234/` —
 * and the number belongs to Playwright's release. Resolving it with a shell
 * glob would put a wildcard where a path belongs; hardcoding it would be wrong
 * on the next upgrade, silently, because a missing binary looks exactly like a
 * browser that failed to start.
 *
 * So Playwright is asked. `executablePath()` is the same function that would
 * launch it, which means the link points at whatever Playwright would have
 * used rather than at our guess about where that is.
 *
 * A string constant with no interpolation, for the reasons in
 * `guard-program.ts`: what it contains is a security property, and there is no
 * point at which anything outside this file becomes program text.
 */
export const IMAGE_LINK_PROGRAM = `
import { symlinkSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";

const target = chromium.executablePath();
if (!target) {
  console.error("image: playwright reports no chromium executable");
  process.exit(1);
}

// Idempotent: a rebuilt image runs this over a link that may already exist.
rmSync(process.env.VIBE_CHROMIUM_LINK, { force: true });
symlinkSync(target, process.env.VIBE_CHROMIUM_LINK);
console.log("image: chromium linked");
`;

/** Where the link program is written, and the fixed path it creates. */
export const IMAGE_LINK = {
  programPath: `${BROWSER_SANDBOX.root}/link.mjs`,
  /** The path `chromiumCommand()` names. One fixed location, whatever the revision. */
  chromiumPath: `${BROWSER_SANDBOX.root}/chromium`,
  env: { VIBE_CHROMIUM_LINK: `${BROWSER_SANDBOX.root}/chromium` },
} as const;

/** Runs the link program under the browsers path it needs to resolve. */
export function imageLinkCommand(): SandboxCommand {
  return { command: "node", args: [IMAGE_LINK.programPath] };
}
