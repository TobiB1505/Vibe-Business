# Marketing

The public landing page and the legal pages: the surface a visitor meets before
there is an account. Moved out of `src/components/marketing/` by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 1,
because a landing page is a product surface and not a primitive — it composes
the real Agent and business-map components rather than drawings of them, which
is the whole argument for it being here.

`src/app/page.tsx`, `src/app/privacy/page.tsx` and `src/app/terms/page.tsx`
compose these; nothing else does. The shell around them —
`marketing-header.tsx` and `marketing-shell.tsx` — is still in
`src/components/layout/` with the rest of the frame and moves with it in
Slice 7.

Two files still reach into the route tree for the components they show:
`landing-agent.tsx` and `landing-business-map.tsx`. Both are recorded in
`src/lib/consistency/feature-boundaries.test.ts` and close when Slice 2 moves
the Agent and Business Health surfaces into their own features.
