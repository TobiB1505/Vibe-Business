# Project settings

What Vibe is connected to, what the founder has told it, and how to disconnect
or delete a project — plus the activity log that records what happened.

Moved out of the route tree by
[ADR 0109](../../../docs/decisions/0109-nova-first-application-shell.md) Slice 2.

```
project-settings-view.tsx  the screen, pure over a settings object
founder-intent-form.tsx    what the founder says the product is for
production-url-form.tsx    the live address Vibe may look at
disconnect-button.tsx      giving up the repository connection
delete-project-button.tsx  the one control that cannot be undone
activity-feed.tsx          the append-only record, over ActivityEntry[]
```

`project-settings-view.tsx` was already extracted from its route so the browser
suite could render it without a session, which is the shape every feature view
is heading for.

Deleting a project and detaching a repository are database authorities, not UI
ones: `modules/projects/` holds the narrow write paths and a migration forbids
a client-side delete outright. The buttons here state a consequence and call
those; they decide nothing.
