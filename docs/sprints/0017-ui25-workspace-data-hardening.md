# Sprint UI-2.5 — Workspace Data Hardening

Two structural weaknesses UI-2 left behind, and nothing else. No new feature, no motion, no
redesign.

## Migration

### Schema

`audit_events.project_id uuid references public.projects(id) on delete set null`, nullable.

**Nullable permanently, not provisionally.** Several event types are genuinely account-level:
`github.authorization.started` happens before any project exists. A NOT NULL column would force
those to invent a project id — the fabrication this codebase refuses everywhere else.

**`on delete set null`, not cascade.** Disconnecting a project deletes its row
(`disconnectProject`), and an audit log that loses its history when the thing it recorded is
removed is not an audit log (ADR 0007). The event survives; only its association clears.

### Index

One, matching the one query that exists:

```
audit_events_project_id_created_at_idx
  on audit_events (project_id, created_at desc, id desc)
  where project_id is not null
```

Equality on `project_id`, then the sort, including the `id` tiebreaker — several events are
written in one statement and share a `created_at` to the microsecond. The partial clause keeps
account-level events out of an index no query asks them for.

### Insert policy

The existing `user_id = auth.uid()` already made a cross-account read impossible. What it did
not prevent was *writing* an event tagged with someone else's project id — which could leak
nothing, but would put a row in an append-only log claiming to describe a project its author
cannot see. The policy now also requires a non-null `project_id` to name a project the caller
owns. Null stays allowed. The select policy is unchanged.

### Backfill — and the defect it exposed

The first migration matched `metadata->>'projectId'` and moved **237 of 277** events. Querying
the remaining 40 afterwards showed the assumption was wrong:

| | count | |
|---|---|---|
| Account-level (`github.*`) | 26 | correctly no project |
| `repository.selected` | 2 | written before the project row exists; only carries `githubRepositoryId` — nothing to resolve without guessing |
| **Carried `project_id`, not `projectId`** | **13** | **missed** |

Every module written from Sprint 11B onwards — merge, approval, outcome, measurement — spells it
`project_id` in metadata. The earlier ones use `projectId`. Nothing ever enforced either,
because until UI-2 nothing read the column back.

The 13 were not incidental. They include `change_merge.default_branch_updated` and
`change_merge.verified` — the two events recording Vibe moving a customer's default branch, the
most consequential entries the log holds. An Activity feed that silently omitted them would be
worse than one that said nothing.

A second migration (`20260815190000`) completes the backfill; the write path now reads both
spellings. **This was found by querying the deployed table, not by reading the writers** — the
kind of defect a convention produces when nothing enforces it.

**Final state, verified against the deployed database:** 277 events, 249 with a project, 28
without — 26 account-level and the 2 `repository.selected`. Nothing unresolved.

## Activity

| | before | after |
|---|---|---|
| Filter | `metadata->>'projectId'` | `project_id` |
| Index | none — sequential over the user's events | `(project_id, created_at desc, id desc)` |
| Page cap | defensive, because the filter could not use an index | a product decision: a feed is for orientation |

Ordering, paging, the `hasMore` probe and the three security layers are unchanged.

## Counts

`getProjectWorkspaceCounts` — two `count`-only queries, `head: true`, no rows transferred.

**Both counts mean what the routes mean:**

- `nextMoves` counts opportunities in the **latest completed set** — what `/moves` renders. Not
  every opportunity row ever produced; regenerating creates a new set, and the old ones are
  history, not a backlog.
- `prepared` counts changes with **`status = 'prepared'`** — what `listPreparedChangesForProject`
  shows. Not every execution job ever run; a discarded change is not something waiting for you.

Verified in the browser: badge 3 = 3 opportunities rendered on `/moves`; badge 2 = 2 prepared
branches on `/prepared`.

**Failure returns null, never zero.** Zero claims "nothing here"; the truth would be "could not
count", and the navigation must not turn one into the other. A zero badge is hidden rather than
rendered — it is decoration, and indistinguishable at a glance from a failure.

## Performance

The layout loads project context plus the two counts, and a test asserts the boundary: it may
not call `getPreparedChangeWorkspace`, `listPreparedChangeSummaries`, `getLatestOpportunities`,
`getLatestSuccessfulAudit`, `getProjectImpact`, any gate card read, or `listAuditEventsForProject`
— nor reach for a sandbox provider, a GitHub merge port or `getPreviewStatus`. UI-2's route
isolation is intact.

## Security

- Insert policy tightened (above); select policy unchanged and still user-scoped.
- Counts run under the caller's RLS-bound client. No service-role anywhere.
- Verified in the browser: all seven routes 200 for the owner, **404** for a foreign project id,
  **307** to login without a session.
- Supabase security advisors after the DDL: four warnings, all pre-existing and none about
  `audit_events` (`set_updated_at` search_path, `rls_auto_enable` SECURITY DEFINER ×2, leaked
  password protection disabled). Out of this sprint's scope, worth a look separately.

## Validation

- `pnpm db:status` — 25 migrations, 0 pending; local and remote agree.
- Schema, index and both policies read back from the deployed database and matched.
- `pnpm lint` · `pnpm typecheck` — clean.
- `pnpm test` — 139 files, 2676 tests (29 new: counts semantics and cheapness, both metadata
  spellings, the layout performance contract).
- `pnpm build` · `pnpm test:e2e` (58 chromium) — green.
- Browser, real data: Activity renders the recovered merge events; badges match their routes
  exactly; 1440 / 768 / 375 with no overflow.

## Next Recommended Phase

**UI-3 — the motion system**, deferred since UI-0 and now with a stable structure to animate.

One follow-up worth scheduling separately: the two `repository.selected` events cannot be
resolved to a project because none existed when they were written. That is a writer-ordering
question, not a schema one, and it affects two rows.
