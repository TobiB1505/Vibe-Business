# The port nobody mentioned

**Recorded 2026-09-07, after the work.** The eighth failure, and the first one
the previous fix paid for immediately.

[Sprint 0152](0152-the-half-of-the-log-i-threw-away.md) started keeping both
ends of a command's output. The very next build put the cause on the first
screen:

```
Ign:3 http://archive.ubuntu.com/ubuntu resolute InRelease
Err:2 http://security.ubuntu.com/ubuntu resolute-security InRelease
  Connection failed [IP: 91.189.91.81 80]
  Connection failed [IP: 185.125.190.81 80]
```

## What it says

**DNS was fine.** The allowlist covers these hosts and apt had four of their
addresses in hand. What failed was the connection, and the log prints the port
it failed on: **80**.

An `allow_domains` policy admits a name over TLS. Ubuntu's default sources are
plain HTTP. So every index came back unreachable, apt ended up with an empty
package list, and the visible symptom was thirty packages it could not find —
including `libx11-6`, which is what made "an empty index" the only reading that
fit.

Three rounds of symptoms, one line of cause, and the line was always there.

## The fix

Rewrite apt's sources to HTTPS before refreshing anything.

Measured first, the same way the Playwright redirect and the Amazon mirror list
were: `archive.ubuntu.com` answers 200 over HTTPS, `security.ubuntu.com`
redirects, and the actual `dists/…/InRelease` serves 200. The archives support
it; only the default configuration does not use it.

`find` rather than `sed` at a fixed path, because Ubuntu 26.04 keeps its sources
in deb822 form under `sources.list.d/` while older layouts use `sources.list`,
and a rewrite at one path is wrong on whichever layout it was not written for.
No shell — `find` parses those arguments itself.

`cli.github.com` joins the allowlist: a third-party archive the base image ships
with, visible in the same refresh. `apt-get update` fails as a whole when any
configured source fails, and an image Vibe does not control decides what is
configured. Tolerating a broken source instead would be the pattern that hid
this for two rounds.

## Verification

8,720 unit tests green, lint 0/0, typecheck and build clean.

## What this does not claim

That the build now succeeds. Three commands sit behind this one that have never
run to completion in a real sandbox — the dependency install, the browser
download under these libraries, and the snapshot — and after them the guard, the
screencast and a real login.

What it does claim is narrower and, at this point, the more useful of the two:
the next thing to fail will say which port, which host, or which package, on the
first screen of its own output.
