# The host the CDN hands off to

**Recorded 2026-09-06, after the work.** The third failure of the first Deep
Scan, and the second one the instrument named. Commands 0 and 1 now pass;
command 2 does not:

```
step: 'image_build_command', commandIndex: 2, exitCode: 1
Error: getaddrinfo EAI_AGAIN storage.googleapis.com
```

## What the error is

Not a download that failed — a **name that was never allowed to resolve**.
`EAI_AGAIN` is DNS, and the build runs under
`{ mode: "allow_domains", domains: IMAGE_BUILD_HOSTS }`. The host was not on
the list.

## Why an allowlist written from the source code was still wrong

`IMAGE_BUILD_HOSTS` was not guesswork. It carried Playwright's own three CDN
mirrors, and the pinned release's `PLAYWRIGHT_CDN_MIRRORS` confirms them
exactly:

```js
PLAYWRIGHT_CDN_MIRRORS = [
  "https://cdn.playwright.dev/dbazure/download/playwright",
  "https://playwright.download.prss.microsoft.com/dbazure/download/playwright",
  "https://cdn.playwright.dev",
];
```

Every one of those is allowed. The list was right about **where the build
asks** and silent about **where the answer sends it**.

Measured rather than reasoned about:

```
HEAD https://cdn.playwright.dev/dbazure/download/playwright/…
307 → https://storage.googleapis.com/chrome-for-testing-public/
                                     143.0.7499.4/linux64/chrome-linux64.zip
```

Playwright's `chromium` on linux-x64 is **Chrome for Testing**, and Chrome for
Testing is published to a Google Cloud Storage bucket. The CDN is a front for
it.

## The part that stings

The list already contained `*.blob.core.windows.net`, which is not a name any
command asks for either — it is the ESRP mirror's own redirect target, one
cloud over. So whoever wrote the list **knew redirect targets belong in it**
and covered the Microsoft one while missing the Google one.

That is the difference between reading a source file and watching a request.
[ADR 0076](../decisions/0076-the-browser-we-own.md) said as much in advance:
*"The build commands are unverified. It is asserted in shape and it is not
proven, and the first real build is where that changes."*

## What was built

One entry, `storage.googleapis.com`, and a test file that stops it being tidied
away — because nothing in this repository references that host. It appears in no
command, no URL and no import. It reads exactly like a stray line, and removing
it returns the build to `EAI_AGAIN` on the next scan.

`image-build.test.ts` also pins the two things production has now taught, so
neither can be quietly undone: the root is created by command 0, and command 0
does not run inside it ([Sprint 0147](0147-the-directory-that-made-itself.md)).

Not widened further. `storage.googleapis.com` exactly, never `*.googleapis.com`
— the second is most of Google's API surface, in a window that exists to fetch
one zip. The build's egress stays separate from the session's `allow_all`, which
is the separation [ADR 0076](../decisions/0076-the-browser-we-own.md) argued for
and this change does not touch.

## Verification

8,703 unit tests green, lint 0/0, typecheck and build clean.

## What is still unproven

The download itself, the snapshot, the guard, the screencast, the input
translation and a real login. Three failures in, the pattern is worth naming:
each one was invisible to every test this repository can run without a real VM,
each took under a minute to fix once named, and the naming is the only reason
any of them took minutes rather than a day.
