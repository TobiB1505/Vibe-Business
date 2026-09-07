# The image that finally built

**Recorded 2026-09-07, after the work.** The ninth click, and the first one where
the hard part worked.

## What now holds

`browser_runtime_images` carries a third row, and this one is a browser that can
actually run:

```
browser-runtime-v3   snap_ZxmirAyy5UIwIysnryyaa4VDKlXV   built 01:02:56
```

Behind that row: apt rewritten to HTTPS, the index refreshed, Playwright's
`install-deps` resolving Ubuntu 26.04's package names, twenty-odd libraries
installed, Chromium downloaded, the revision-numbered path resolved, the guard
written in, the snapshot taken.

And the proof, from Vibe's own probe rather than from hope:

```
chromiumExitCode: 0
chromiumOutput: 'Google Chrome for Testing 151.0.7922.34'
```

Six failures stood between the first click and that line. Every one of them was
a build, and the builds are done.

## What does not hold

```
step: 'session_ready_timeout', guardFailure: 'none recorded'
```

Chromium starts. The guard neither reports ready **nor records why**, and those
two absences together are the finding: `giveUp` writes the failure file, so
nothing written means the guard never reached a line of its own code.

A module that fails to import does exactly that. It prints its reason and exits
before the program begins, which is precisely the case `runBackground` cannot
show anybody — it detaches, and a detached process's output has no reader.

## The probe, one layer further

The same move that worked for Chromium, applied to the other program: on a
readiness timeout, run the guard **in the foreground**, where `run()` returns
what it printed.

Both outcomes are answers. Output means the guard cannot start and says why. A
clean timeout means it can — a guard that starts correctly never returns, it
listens — and the problem is somewhere this probe is not looking.

Its files are the probe's own: `ready.probe`, `guard-failure.probe`, and a port
one above the real one. A second guard writing the ready file would turn a
diagnosis into a session reporting itself usable after it had been given up on,
and a probe that changes the thing it measures is worse than no probe.

## Verification

8,722 unit tests green, lint 0/0, typecheck and build clean.

The probe test plants the shape actually suspected — `Cannot find package 'ws'`
— and a second test asserts the probe cannot write the files the session waited
on.

## Where this stands

Nine clicks. Two screens, one silent failure, four build failures, two of my own
wrong assumptions — and now a browser that runs, in an image that rebuilds
itself, behind a guard that has never once been seen to start.

The instrument is four layers deep: the step, the guard's own verdict, the
browser's first line, and now the guard's. That is everything observable from
outside the VM.
