# The libraries nobody downloaded

**Recorded 2026-09-07, after the work.** The fifth failure of the first Deep
Scan, and the first one the instrument answered completely on its own:

```
step: 'session_ready_timeout',
guardFailure: 'none recorded',
chromiumExitCode: 127,
chromiumOutput: '/vibe-browser/chromium: error while loading shared libraries:
                 libglib-2.0.so.0: cannot open shared object file'
```

[Sprint 0149](0149-the-wait-that-explained-nothing.md) shipped the
`chromium --version` probe on a hunch that a missing library would be worth
seeing. It was the answer, twelve minutes later.

## The defect

`playwright install chromium` downloads a browser. It does **not** install the
system libraries that browser links against, and the sandbox's base image does
not carry them. Chromium exited 127 before it opened anything, so the guard
waited its thirty seconds for a DevTools port that was never going to exist.

Playwright's own `--with-deps` cannot help: its `nativeDeps` table covers Debian
and Ubuntu only, and a Vercel sandbox is **Amazon Linux 2023**.

## Not translated from memory

The list is Playwright's own, mapped one package at a time. Every entry is one
line of `nativeDeps["ubuntu26.04-x64"].chromium` in the pinned release —
twenty-one packages — turned into the RPM that provides the same libraries.
`glib2` is `libglib2.0-0t64`, the one the loader named first.

`liberation-fonts` is the single addition, from Playwright's `tools` list. A
browser with no font renders a sign-in form as boxes: a Deep Scan that works
perfectly and fails for a reason no error would ever state.

**The mapping is the part that could still be wrong**, and it fails loudly
rather than silently — the probe names the next missing library by itself, which
is how this one was found.

## Two things had to be built to run one command

**Root, through the port.** `dnf` needs it, and `SandboxHandle.run` had no way
to ask. That option is dangerous in a way worth being explicit about:
validation, preview and the agent all call the same method, and every one of
them runs commands a *customer's repository* supplies. Root there is exactly the
hazard [ADR 0015](../decisions/0015-untrusted-repository-execution-provider.md)
exists to prevent, and it would be one word to do.

So `sudo-scope.test.ts` was written alongside it, on the model of
`network-policy-scope.test.ts`, and an entry has to argue the same kind of thing:
not that root is needed — everything wants root — but **that nothing in that VM
came from outside Vibe**. The browser image build is the only sandbox in the
product created with no source at all.

`sudo` is a field on the build step rather than on `SandboxCommand`, because
that type is shared with validation and preview, where a command that can ask
for root must not exist.

**One repository host.** Measured rather than assumed, the same way the
Playwright redirect was: `cdn.amazonlinux.com/al2023/core/mirrors/latest/x86_64/mirror.list`
answers with URLs on `cdn.amazonlinux.com` itself, so one name is the whole
requirement and no wildcard is needed.

## The version bump is load-bearing again

`browser-runtime-v3`. The image lookup is keyed on it, and an image built
without the libraries is not an image with them. Skipping this would have
reused yesterday's snapshot and produced exactly the same 127.

## Verification

8,716 unit tests green, lint 0/0, typecheck and build clean.

## Where this stands

Five failures. `chdir` into a directory that did not exist; a CDN redirect to an
unallowed host; a browser with no libraries — and, before those, a screen with no
button and a failure with no message. Each was invisible to every test this
repository can run without a real VM. Each was named within minutes of a click,
and four of the five were named by the instrument rather than by guesswork.

What is still unproven: the guard, the screencast, the input translation, and a
real login.
