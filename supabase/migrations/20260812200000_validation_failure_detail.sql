-- Sprint 10A post-dogfood: make a failed validation explain itself.
--
-- The first two real runs failed at `verifying_source` and `provisioning`, and
-- the database recorded only the failure codes. Nothing said *why* — the
-- adapter caught the provider error and returned a generic string, and the
-- orchestrator's outer catch discarded the value entirely.
--
-- That was a deliberate rule applied too widely. Raw provider prose must never
-- escape (CLAUDE.md rule 40, ADR 0011), and untrusted output must never be
-- stored unbounded (§15) — but "store nothing" makes a production failure
-- undiagnosable, which is its own kind of unsafe.
--
-- `failure_detail` holds the same bounded, ANSI-stripped, secret-redacted tail
-- already used for step output. Same sanitizer, same limits: it is untrusted
-- text either way.

alter table public.validation_runs
  add column failure_detail text;

comment on column public.validation_runs.failure_detail is
  'Bounded, sanitized explanation for failures that occur outside a validation step (source acquisition, credential scrub, provisioning). Same sanitizer and limits as step output — never raw provider prose, never unbounded.';

alter table public.sandbox_usage_events
  add column failure_detail text;

comment on column public.sandbox_usage_events.failure_detail is
  'Bounded, sanitized failure explanation, so the infrastructure ledger can be read without joining back to a possibly-deleted validation run.';
