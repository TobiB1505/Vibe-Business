# Product

What Vibe understands about the customer's product, as a surface: the Product
Scan experience a founder watches, and — from Slice 2 — the My Product screen,
the understanding panel and the Deep Scan spotlight.

`ProductScanExperience` moved out of `src/components/product-scan/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 1.
It is 1,382 lines, it binds two Server Actions and it polls: a surface by every
reading, and it was in the component layer because there was nowhere else to
put it. Its four variants — `onboarding`, `workspace`, `block`, `showcase` —
are the same view in four frames, which is the pattern the workspace host
depends on in Slice 4.

Its two Server Action imports are recorded in
`src/lib/consistency/feature-boundaries.test.ts` and close when Slice 3 gives
this feature a `commands.ts`.
