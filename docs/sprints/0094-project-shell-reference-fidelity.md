# UI-16 — Project Shell Reference Fidelity

Status: Implemented, browser verification in progress

Date: 2026-08-24

## Outcome

The project workspace now has one context owner. The left rail carries the
current product, stored repository connection, bounded product switcher,
`All products`, project navigation and the account disclosure. Project Settings
is separated from Profile, Account settings, Billing and Sign out.

The old sticky project/repository header is removed. Every project route begins
with a quiet account-to-product breadcrumb and one route-owned title,
description and action. On desktop the rail occupies the viewport and the main
document scrolls independently inside a 1440px content boundary, so long Product
and Business Health surfaces never pass underneath shared chrome.

The switcher uses only real project rows, displays at most four alternatives,
and fails open to the current product plus the complete products index. No new
domain state, provider, migration, external call or paid operation was added.

## Verification boundary

Unit and browser fixtures cover the bounded switcher, disclosure states,
route-owned H1, absent sticky header and desktop scroll ownership. The deployed
preview remains the final visual comparison against the supplied shell
reference.
