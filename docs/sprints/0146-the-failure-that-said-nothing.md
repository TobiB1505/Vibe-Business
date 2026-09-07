# The failure that said nothing

**Recorded 2026-09-06, after the work.** The first real Deep Scan on Vibe's own
sandbox browser. It failed, and the interesting part is not that it failed —
[ADR 0076](../decisions/0076-the-browser-we-own.md) said plainly that none of it
had ever run in a real Vercel sandbox — but that **nothing anywhere said why**.

## What the founder saw

A button (shipped hours earlier by [Sprint 0145](0145-the-card-with-no-button.md)),
a click, and one amber sentence: *"Deep Scan couldn't start. Try again in a
moment."*

## What could actually be established

Everything except the cause.

| Question | Answer | Where from |
|---|---|---|
| Was the secret set? | Yes — the button renders only when `hasBrowserSandboxSecret()` is true | the screenshot itself |
| Were Credits charged? | **No.** 25,000 units reserved 23:28:32.207, released 23:28:36.048, `failed_without_usage` | `billing_credit_reservations` |
| Did a session exist? | No row — it failed before `createSessionRecord` | `authenticated_browser_sessions` |
| Was an image built? | No row at all | `browser_runtime_images` |
| Why did it fail? | **Nothing recorded it** | — |

The billing behaved exactly as designed, which is worth stating: the hold came
before the browser, the browser never arrived, and the money went back in under
four seconds without anyone asking.

**And the four seconds are the clue the logs could not give.** A build downloads
Chromium and installs a package; it cannot fail in 3.8 seconds. So the failure is
early — the build sandbox itself, or the very first command — and not the long
tail everyone would have guessed at.

## Why nothing said why

`src/modules/authenticated-product-intelligence/sandbox-browser/` had **eight**
failure points and every one of them was a bare `catch` returning one of two
opaque codes:

```ts
} catch {
  return failure("browser_session_create_failed");
}
```

Sentry had no issue, because nothing was ever reported. Vercel's logs had the
`POST` and a `200`, because a Server Action returns a typed refusal rather than
an error. Eight causes, one sentence, and no way to tell them apart from outside
the VM.

The repository already had the answer and this module was not using it:
`alertOperator` logs locally **and** reports to Sentry, scrubbed, and never
throws — written in VB-012 for exactly this, *"the detection work was done and
the result went nowhere"*.

## What was built

`diagnostics.ts`: eight named steps, an error description, and one call.

`image_build_create`, `image_build_command`, `image_build_write`,
`image_build_snapshot`, `session_create`, `session_start_programs`,
`session_ready_timeout`, `session_public_origin`. The names are the point —
a Chromium download that 404s and a guard that never reports ready are different
problems with different fixes.

Three choices worth recording:

**The customer-facing message is unchanged.** A provider's error text belongs to
the operator, not to the person waiting for a browser (§17). A test asserts the
provider's account does not reach the caller.

**The build's output is included, bounded to 1,500 characters.** It is Vibe's own
commands talking — a browser download and a package install — with no customer
input anywhere in that VM. Bounded because a registry answering with an HTML
error page must not turn one failure into a megabyte of log.

**`describeError` returns a string, never an object and never a stack.** A
provider error can carry a request body and a body can carry a token; `scrub.ts`
is the last line of defence rather than the first.

## Verification

8,695 unit tests green, lint 0/0, typecheck and build clean.

The reporting test was proved by planting the real defect — deleting the call
from the failing-build path — and exactly one test went red. Without that, the
next refactor removes the diagnosis silently, which is the same failure this
sprint exists to fix.

## What this does not do

**It does not fix the Deep Scan.** It is a diagnosis, not a repair, and saying
otherwise would be the second time this feature claimed something it had not
demonstrated. The next click is what produces the cause; the four-second shape
says to look at the build sandbox's creation rather than at the download.
