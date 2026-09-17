# Account

The commands the account-level surfaces own: billing, the founder's name, and
erasing the account. The screens themselves are under
`src/app/app/(account)/settings/` — one rail and a set of pages, and
[ADR 0104](../../../docs/decisions/0104-the-account-level-is-settings.md) is why
they are Settings rather than a dashboard.

```
commands/billing-actions.ts         the Stripe checkout and portal sessions
commands/founder-name-actions.ts    what Vibe calls the person using it
commands/delete-account-actions.ts  erasure, which is its own operation
```

`billing-actions.ts` is one of the two entries in `REVIEWED_SITES` in
`src/lib/supabase/service-boundary.test.ts` — rule 53's record of every caller
using the service-role client outside `src/modules/operations/`, with the reason
it may. Moving the file here moved a path there; nothing was added.

Erasure is irreversible and costs nothing, which is exactly the shape whose
confirmation has to be real: it is an operation with its own type, its own
surface and its own copy, never a button beside the profile fields.
