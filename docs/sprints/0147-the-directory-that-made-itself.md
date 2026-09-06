# The directory that made itself

**Recorded 2026-09-06, after the work.** [Sprint 0146](0146-the-failure-that-said-nothing.md)
made the Deep Scan's failure legible. This is what it said, twelve minutes later,
on the founder's next click:

```
deep scan: the browser session could not start {
  step: 'image_build_command',
  commandIndex: 0,
  exitCode: 1,
  output: 'failed to start process: chdir /vibe-browser: no such file or directory'
}
```

## The defect

Command 0 of the image build is `mkdir -p /vibe-browser`, and `image.ts` was
starting it with `cwd: BROWSER_SANDBOX.root` — `/vibe-browser`. The command
whose whole job is to create the directory was being asked to run inside it.

Nothing downstream ever ran. No image was built, no session existed, and the
panel said *"Deep Scan couldn't start. Try again in a moment."* for what was, in
the end, one wrong argument.

## Why nothing caught it

Because this is the only sandbox in the product with no source.

A validation or preview sandbox is created from a **git source**, and the clone
makes the working directory before the first command runs. `cwd: root` is
correct there and has been for every sandbox this repository had — until
[ADR 0076](../decisions/0076-the-browser-we-own.md) added `{ kind: "image" }`,
which is the base image and nothing else. No clone, no source, nothing on the
filesystem to be in.

So the build acquired the one job no previous sandbox had — making its own
directory — and inherited the working directory from callers that never needed
to. `image-build.ts` even opens with the `mkdir` and says why; the wiring one
file over disagreed and nothing compared them.

The unit tests could not see it: the fake sandbox provider records `cwd` and
nothing asserted anything about it, because until this sandbox existed there was
nothing to assert.

## The fix

`IMAGE_BUILD_CWD = "/"`, a named constant carrying the reason rather than a
literal at two call sites.

Every build command already addresses its target absolutely — `mkdir -p` the
root, `npm install --prefix` it, `PLAYWRIGHT_BROWSERS_PATH` under it, `node`
with the program's full path — so none of them needs a working directory at all.
`/` is simply somewhere certain to exist.

## The test asserts the property, not the constant

`cwd === "/"` would pass over a build that made a second directory and then ran
inside *that*. What has to hold is that **no command runs somewhere the build
has not created yet**, so the test walks the transcript keeping the set of
directories that exist — which is what the sandbox does.

Two directories start in that set and the distinction is the interesting part.
`/` is the base image's root. `.` is wherever the provider started the process,
which `writeSandboxTextFile` uses — correctly, because it redirects to an
absolute path and needs no directory of its own. Everything else must be made
first.

Proved by restoring the original argument: the test fails with
*"`mkdir -p /vibe-browser /vibe-browser/browsers` runs in /vibe-browser, which
nothing has created yet"* — the production error, in words, from a unit test.

## Verification

8,697 unit tests green, lint 0/0, typecheck and build clean.

**This is still not proof the Deep Scan works.** It is proof that command 0 can
now start. Behind it sit an npm install, a Chromium download, a revision-numbered
path resolved by Playwright, a snapshot, a guard and a screencast — none of which
has ever run either, and each of which [ADR 0076](../decisions/0076-the-browser-we-own.md)
listed as unverified. What changed twelve minutes ago is that the next one to
fail will say so by name.
