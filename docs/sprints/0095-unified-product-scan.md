# UI-15 — Unified Product Scan

Status: Implemented

Date: 2026-08-24

## Outcome

A founder no longer runs "repository intelligence" and then "a live product
check" — they scan their product. `runProductScanAction` reads the code and,
whenever a production URL is stored, visits the site in the same pass,
mirroring onboarding's `beginUnderstandingAction` including its stepped
failure shape. One Product Scan Surface replaces the two per-module controls
on My Product; the words "repository intelligence" and "live product check"
leave every customer string, pinned by a banned-copy test in
`command-center-ui.test.ts`. Module names, file paths and audit event names
are unchanged — they are records and internals, not customer language.

No ADR: the action stays sequential and in-request exactly like the shipped
onboarding path, so no background technology is introduced (rule 24), and
both sources remain free — no credit path exists below either service.

## Honest source states

The source rows grow from a boolean to four states:

- **read** — the source was read, and the read is the whole picture.
- **partially read** — the live product was visited and could not be fully
  read (usually client-rendered pages). The row's caveat is the sentence
  `describeIncompleteness` already produces for the full summary — exported
  rather than re-written, so the row and the summary cannot disagree.
- **failed** — the last attempt produced no result and none exists from
  before. Backed by new latest-attempt reads in both snapshot stores;
  everything that consumes results keeps reading successful snapshots. A
  failure after an earlier success does not erase data the founder can
  still see: the ready state wins.
- **not yet** — a fact about Vibe, never a demand on the founder.

## The retry defect

`retryProductScanAction` re-ran only the repository read. A founder whose
live check failed and who pressed Try again got a product understanding
built without their site — reported as success, with nothing on screen
saying the live half had been skipped. The retry now runs both sources,
decided by the stored production URL, and a live failure fails loudly
through the same stepped state as the first attempt. Proven red first in
`first-journey.test.ts`.

## Deliberately untouched

- **Deep Scan** — a separate, metered control with its own consent flow; it
  is a source row and a child route, not part of the free scan.
- **Audit events** — `onboarding.product_scan_*`,
  `repository.intelligence.*` and `live_product.intelligence.*` keep their
  names; stored events are records.
- **The services** — `inspectRepository` and `inspectLiveProduct` are
  unchanged; the merge is an app-layer sentence, not a module merge.
