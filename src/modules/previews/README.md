# modules/previews

Preview Layer — see [ARCHITECTURE.md §3.9](../../../ARCHITECTURE.md#39-preview-layer) and [ADR 0004](../../../docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md) (`PreviewProvider` boundary, Vercel Preview Deployments first).

**Status:** boundary reserved only. No `PreviewProvider` implementation exists yet.

## Not to be confused with `modules/change-preview`

Two different things, at two different trust levels, and keeping them in
separate modules is what stops one inheriting the other's authority by accident:

| | this module | [`change-preview`](../change-preview) |
| --- | --- | --- |
| Mechanism | Vercel **Preview Deployment** | Vercel **Sandbox**, restored from a validated snapshot |
| Runs in | the customer's Vercel project | an isolated microVM Vibe owns |
| Environment | the customer's own configuration | three variables, none granting anything |
| Lifetime | as long as the deployment lives | 15 minutes |
| Authority | a deploy | none — the artifact was already built |
| ADR | [0004](../../../docs/decisions/0004-vercel-as-initial-host-and-preview-provider.md) | [0016](../../../docs/decisions/0016-temporary-preview-isolation.md) |

`change-preview` exists because the deploy route needs authority the product
does not have: the customer's hosting, their secrets, and a build Vibe did not
perform. It is a way to *look* at a validated change, not a way to ship one.
