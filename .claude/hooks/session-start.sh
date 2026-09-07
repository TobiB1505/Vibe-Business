#!/bin/bash
#
# Migration drift, reported at the start of every session.
#
# ## The failure this closes
#
# On 2026-09-07 the production database held 126 migrations and this repository
# held 124. Two — `founder_profiles` and `action_plan_handoff` — existed only
# remotely: two tables, four RLS policies, three indexes and a SECURITY DEFINER
# function, with no file in the repository and no commit on any branch. They
# came from parallel sessions that applied them through the Supabase API rather
# than committing the file.
#
# CLAUDE.md rule 34 says migration files are the source of truth and the remote
# database converges to them. This was the other direction, and it was invisible:
# `pnpm db:test` in CI builds a fresh PostgreSQL from the files, so it never
# looks at the real database, and nothing else does either. It was found by
# hand, three days later, by somebody who happened to check.
#
# `pnpm db:status` has always answered exactly this question. Nobody ran it.
# That is the whole reason this hook exists rather than a new check: the tool
# was already there, and a tool nobody runs is not a safeguard.
#
# ## It never blocks and never writes
#
# `supabase migration list` is read-only. Every failure path here exits 0 with
# one line of explanation: a session that cannot reach the database is a normal
# session, and a hook that broke one over a diagnostic would be worse than the
# drift it reports.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

note() { printf '  %s\n' "$*"; }

echo "── Migration drift ────────────────────────────────────────"

if ! command -v pnpm >/dev/null 2>&1; then
  note "pnpm is not on PATH — skipping."
  exit 0
fi

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  note "SUPABASE_ACCESS_TOKEN is not set, so the remote history cannot be read."
  note "Set it and re-run 'pnpm db:status' to compare local files against the database."
  exit 0
fi

# Rule 32: derive the project ref from safe local configuration, never guess it.
# The hostname of the application's own Supabase URL is the ref, which also
# makes it impossible for this to reach an unrelated project (rule 33).
SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-}"
if [ -z "$SUPABASE_URL" ] && [ -f .env.local ]; then
  SUPABASE_URL="$(grep -m1 '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"'"'"' ')"
fi

PROJECT_REF="$(printf '%s' "$SUPABASE_URL" | sed -n 's#^https://\([a-z0-9]\{20\}\)\.supabase\.co/*$#\1#p')"

if [ -z "$PROJECT_REF" ]; then
  note "No Supabase project ref could be derived from NEXT_PUBLIC_SUPABASE_URL."
  note "Not guessing one — rule 32. Run 'pnpm db:status' by hand once linked."
  exit 0
fi

if [ ! -f supabase/.temp/project-ref ]; then
  if ! pnpm exec supabase link --project-ref "$PROJECT_REF" >/dev/null 2>&1; then
    note "Could not link project $PROJECT_REF — skipping the drift check."
    exit 0
  fi
fi

STATUS="$(pnpm db:status 2>&1)" || {
  note "'pnpm db:status' could not read the remote history — skipping."
  exit 0
}

# `supabase migration list` prints one row per version with a Local and a Remote
# column. A row with a remote version and no local one is a migration applied to
# the database that this repository does not carry; the reverse is a file that
# has not been pushed yet. Both are drift and both are worth a sentence.
# Columns are `Local | Remote | Time (UTC)`, so field 1 is local and field 2 is
# remote. Written down because the first version of this had them one apart and
# reported nothing at all, cheerfully — a check that silently matches nothing is
# the failure mode this repository keeps finding, and it found this one too.
REMOTE_ONLY="$(printf '%s\n' "$STATUS" | awk -F'|' 'NF>=3 && $1 ~ /^[[:space:]]*$/ && $2 ~ /[0-9]{14}/ {gsub(/ /,"",$2); print $2}')"
LOCAL_ONLY="$(printf '%s\n' "$STATUS" | awk -F'|' 'NF>=3 && $2 ~ /^[[:space:]]*$/ && $1 ~ /[0-9]{14}/ {gsub(/ /,"",$1); print $1}')"

if [ -z "$REMOTE_ONLY" ] && [ -z "$LOCAL_ONLY" ]; then
  note "Local files and the remote database agree."
  exit 0
fi

if [ -n "$REMOTE_ONLY" ]; then
  note "APPLIED REMOTELY, NOT IN THIS REPOSITORY (rule 34 — the file is the source of truth):"
  printf '%s\n' "$REMOTE_ONLY" | while read -r version; do note "  $version"; done
  note "Commit the migration file, or ask the session that applied it to."
fi

if [ -n "$LOCAL_ONLY" ]; then
  note "IN THIS REPOSITORY, NOT YET APPLIED:"
  printf '%s\n' "$LOCAL_ONLY" | while read -r version; do note "  $version"; done
  note "Inspect with 'pnpm db:status' before 'pnpm db:push' (rule 30)."
fi

exit 0
