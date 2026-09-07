# The machine nobody asked

**Recorded 2026-09-07, after the work.** The sixth failure, and the first one
that was **my** mistake rather than the code's:

```
step: 'image_build_command', commandIndex: 1, exitCode: 1
output: 'sudo: dnf: command not found'
```

## What I got wrong

[Sprint 0150](0150-the-libraries-nobody-downloaded.md) installed Chromium's
shared libraries with `dnf`, on the strength of Vercel's documentation saying
Amazon Linux 2023. That documentation is for the **build image** — the machine
that compiles a deployment — and a sandbox is a different machine entirely. I
read a real source, found a real sentence, and applied it to the wrong system.

Which is the same error as [Sprint 0148](0148-the-host-the-cdn-hands-off-to.md),
one level up: reading a source file rather than watching the thing run. The
allowlist there was right about where the build *asks* and wrong about where it
is *sent*; this was right about a Vercel image and wrong about which one.

The second assumption was worse because it was unfalsifiable from here: the
package list was hand-mapped from Playwright's Debian names to their RPM
equivalents, and no test in this repository can check a translation like that.
It was twenty-one guesses wearing the clothes of a citation.

## The fix removes both assumptions rather than correcting one

`npx playwright install-deps chromium`, as root.

Playwright detects the distribution itself and installs the packages **it** says
that distribution needs — the same table `--with-deps` uses, maintained by the
people who build the browser. Where it cannot, it says so in a sentence the
instrument reports.

The download stays unprivileged: only the package manager runs as root, so the
browser is owned by the user that runs it rather than by root.

## And the machine now names itself

Two build failures in a row turned on which machine this is, so every build
failure from here carries `/etc/os-release`. Guessing a third time was available
and is not what this repository is for.

The egress list names all three distribution families rather than one — Amazon
Linux, Debian, Ubuntu. Wider than the rest of that window and deliberately so:
every entry is a package archive, reached in a VM holding no customer
repository, no credential and no source. An unnecessary name costs nothing; a
missing one fails visibly as `EAI_AGAIN` naming the host it wanted.

## No version bump

`browser-runtime-v3` has no row. The v3 build has never succeeded, so there is
no snapshot to invalidate and the next attempt builds from scratch either way.
v1 and v2 remain recorded, and both are images of a browser that cannot start.

## Verification

8,716 unit tests green, lint 0/0, typecheck and build clean.

## Where this stands

Six failures. Two were mine — a package manager from the wrong machine, and a
package list nothing could check. Four were the code's. All six were named
within minutes, and the two that were mine were named by the same instrument as
the rest, which is the point: it does not distinguish between a bad line of code
and a bad assumption, and it should not.
