# Sprint 0154 — The rule the screen stated and did not check

**Date:** 2026-09-07
**Decision:** none. Logic on four public routes; the design pass is separate and comes next.

## What was asked

The auth screens: logic first, design after.

## What was wrong

**The interface stated the rule correctly, checked it incorrectly, and enforced it correctly — in that order, on one screen.** The hint above the password field said *At least 8 characters*. The input said `minLength={6}`. The server refused anything under eight. So a seven-character password passed the browser's own check, was submitted, and came back rejected by the field the browser had just approved.

The cause was structural. `MINIMUM_PASSWORD_LENGTH = 8` lived in `actions.ts`, which is `"use server"` — every export there must be an async function, so no input could read it. Three inputs carried a literal `6` instead. And `actions.ts` argues at its own call site that the rule is refused in this repository rather than left to the provider's dashboard setting *"so that a reader of this code can determine what the rule is"* — which only works if there is one place to read it.

**A missing confirmation counted as a matching one.** `updatePassword` read `typeof confirmation === "string" && confirmation !== password`, so a submission carrying no confirmation field at all skipped the check and set the password. The browser marks the field `required`; that is a convenience for a person, not a property of a request.

**A refusal was displayed and not announced.** `Field` binds its error to the input with `aria-describedby`, which is read when focus *arrives* at a field — and says nothing when text appears under a field the person has already left, which is when every rejected submission renders one. On every form in the product.

**None of the four screens had a `main` landmark.** Measured: `document.querySelector("main")` was null on `/login`, `/signup`, `/forgot-password` and `/reset-password`. `AuthShell` rendered two `div`s. These are the first four screens a stranger meets.

**Two success states could not be checked.** "Check your email" without naming the address it went to. The field it was typed into is gone by then, so somebody who mistyped their own address waits for an email that was never going to arrive.

## What was built

`src/modules/auth/password.ts` holds the number, the hint and the refusal sentence. `actions.ts` imports it; the three inputs import it; the hint is built from it. There is nowhere left to disagree.

The confirmation is compared unconditionally. The `Field` error carries `role="alert"`. The form column is a `main`. Both success notices name the address — and on `/forgot-password` that leaks nothing, because the sentence still refuses to say whether an account exists and the address is the one the person just typed.

## What a mutation found in my own guard

The first version of the `role="alert"` assertion read the whole `{error && …}` branch — **including its docblock, which explains the fix and contains the string `role="alert"` in prose.** It passed with the attribute deleted.

Comments are stripped now, the way every other source guard in this repository does it. The lesson is not new; the point is that the test was written *and mutation-tested in the same sitting*, and only the second step found it.

## What the guards say

Four new, all mutation-tested by restoring the old behaviour:

- No form that collects a password writes a length or the sentence by hand, and `actions.ts` does not define the minimum a second time. Restoring `minLength={6}` fails it.
- `updatePassword` refuses a submission with no confirmation, without calling Supabase.
- `Field`'s error is an assertive live region and the hint is not. Deleting the attribute fails it.
- All three public auth routes have exactly one `main`. Turning it back into a `div` fails all three.

And one changed: the anti-enumeration test on `requestPasswordReset` compared two calls with two *different* addresses and asserted the results were identical — which could only ever compare shapes. It holds the address fixed now and varies only whether Supabase says the user exists, which is what the property actually claims, plus an assertion that the echoed value is exactly what was submitted so the echo cannot become a channel of its own.

There is also one browser test fewer than planned: with the browser and the server agreed, a short password no longer reaches the server, so there is no server-side refusal left to assert on that screen. It asserts the browser's `validity.tooShort` instead — the end-to-end proof that the disagreement is gone.

## What is not done

The design pass. Also noted and deliberately not acted on: a form-level error such as "Enter your email and password" renders under the *password* field, because that is the `Field` it was wired to. That is a placement question for the design pass, not a defect in the logic.

## Validation

Unit 8,847 · browser 608 · lint 0/0 · typecheck clean · no migration.
