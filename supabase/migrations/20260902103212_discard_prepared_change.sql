-- A prepared change a person looked at and said no to.
--
-- `PreparedChangeStatus` has carried a fourth value since the table was
-- created — and the CHECK never did, so nothing could write one and nothing
-- did. The consequence was not cosmetic: there was no way to reject a change
-- at all. A change a founder did not want stayed `prepared` forever, kept
-- answering "this Move already has a prepared change" on the Agent screen, and
-- held `prepared_changes_single_active_idx` against its own execution
-- identity — so the step could not be run again either.
--
-- `discarded` rather than `superseded`, because that is what actually happens:
-- a person decided. Nothing replaces the row automatically, and inventing a
-- second value for an event that does not exist would be the same phantom one
-- table over.
--
-- The unique index is deliberately not touched. It is scoped to
-- `('preparing', 'prepared')`, so a discarded row leaves the active set by
-- construction and the same step becomes runnable again. That is the whole
-- mechanism.

alter table public.prepared_changes
  drop constraint if exists prepared_changes_status_check;

alter table public.prepared_changes
  add constraint prepared_changes_status_check
  check (status in ('preparing', 'prepared', 'failed', 'discarded'));

-- A discarded change was `prepared` a moment ago, so it already carries a
-- `completed_at`. Without widening this, every discard would fail the terminal
-- constraint rather than the status one — a rejection that reads as a bug.
alter table public.prepared_changes
  drop constraint if exists prepared_changes_terminal_has_completed_at;

alter table public.prepared_changes
  add constraint prepared_changes_terminal_has_completed_at
  check ((status in ('prepared', 'failed', 'discarded')) = (completed_at is not null));

comment on column public.prepared_changes.status is
  'preparing → prepared → discarded, or failed. `discarded` records a human rejection and frees the execution identity for a new run; nothing sets it automatically.';
