# The half of the log I threw away

**Recorded 2026-09-07, after the work.** The seventh failure, and the second one
caused by the instrument rather than by the browser.

## What the machine finally said

Sentry carried what the log line truncated:

```
PRETTY_NAME="Ubuntu 26.04 LTS"   ID=ubuntu   VERSION_CODENAME=resolute
```

**Ubuntu 26.04**, not Amazon Linux. Which means
[Sprint 0151](0151-the-machine-nobody-asked.md) was right to delegate:
`install-deps` detected the distribution correctly and asked apt for exactly the
packages Playwright's `ubuntu26.04-x64` table names.

apt could not find one of them:

```
E: Unable to locate package libx11-6
E: Unable to locate package libnss3
… twenty-eight more
```

`libx11-6` is not missing from Ubuntu. **Every package unavailable is not thirty
missing packages — it is an empty index**, and an empty index is one failure with
one cause.

## The cause was in the half I did not keep

`output.slice(-1500)`. A failing `apt-get install` prints one line per package,
so the last 1,500 characters were thirty of those and nothing else, while
whether `apt-get update` had succeeded at all was in the first few lines and had
been thrown away.

That is a general shape, not an accident of this build: **the cause is near the
start and the consequences fill the end.** `boundedOutput` now keeps both ends
and says how many characters it dropped, which is what makes a truncated log
honest rather than merely short.

## And the refresh is now its own step

`install-deps` runs `apt-get update` itself, and that is exactly what hid this:
a failure inside it surfaced as thirty missing packages in another command's
output.

Lifted out, it fails with its own exit code and its own report, and cannot be
mistaken for a browser whose dependencies have vanished from Ubuntu.

`apt-get` by name rather than something distribution-agnostic, because the
distribution is no longer a guess — `/etc/os-release` said so. If the image ever
changes, the step reports `apt-get: command not found`, which is how the last
wrong assumption was caught and cheaper than assuming again.

## Verification

8,718 unit tests green, lint 0/0, typecheck and build clean.

The output test plants the real shape: a cause on the first line, six hundred
lines of filler, a consequence on the last. Both survive; the middle does not,
and the log says how much went.

## What this still does not know

**Why the index was empty.** The next build says it in a step of its own — a
blocked host, an unreachable mirror, or an image that ships with no sources at
all are three different answers and the log will name which. Widening the
allowlist now, on a hunch about which of the three it is, is the mistake this
sprint exists to stop making twice.
