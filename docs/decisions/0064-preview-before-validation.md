# ADR 0064 — The preview comes before the check, and serves the commit

**Status:** Accepted — 2026-09-01
**Supersedes:** [ADR 0016](0016-temporary-preview-isolation.md) §1 (the validated artifact as the only source), §3 (the restore-time integrity recheck), §7 (`next start`, never `next dev`) and §11 (artifact deletion as part of teardown). Everything else in ADR 0016 stands: the confirmation, the fifteen-minute TTL, the secret policy, the egress windows, the credential scrub and the durable teardown.
**Related:** [ADR 0015](0015-untrusted-repository-execution-provider.md), [ADR 0065](0065-the-preview-is-the-review.md), [Sprint 0114](../sprints/0114-the-preview-is-the-review.md)

## Context

A preview booted the filesystem snapshot a **passing** validation captured. Validation's last step is the build, and a measured run is roughly install 18s → typecheck 79s → test 84s → build 99s. So a person waited about five minutes before they could look at code that had been finished before the wait began — and then paid again, in seconds, for the snapshot to be restored and its integrity re-verified.

The waiting was not a consequence of previewing being expensive. It was a consequence of what a preview *claimed*: ADR 0016 §7 tied the preview to the validated build so that what a person opened was the artifact that had passed. The claim was honest and the cost of it was five minutes of nothing.

Two facts about the provider shaped what could be done about it. **Ports are settable only at `create()`** — `applyNetworkPolicy` governs egress and `publicOrigin(port)` only reads a route — so a preview cannot borrow the validation sandbox without exposing unchecked code on a public URL from the first second. And a `SandboxProcess` cannot cross a durable step boundary, so a server started in one step is not there in the next.

## Decision

**A preview clones the prepared commit and runs a development server.** It no longer restores a snapshot, no longer waits for a validation, and no longer needs one to exist.

```
create(source: git @ preparedCommitSha, ports: [3000],
       networkPolicy: allow_domains SOURCE_HOSTS, env: PREVIEW_ENVIRONMENT)
  ─▶ git rev-parse HEAD === preparedCommitSha     else preview_repository_changed
  ─▶ rm -rf .git, then verify it is gone          else preview_credential_scrub_failed
  ─▶ applyNetworkPolicy(allow_domains DEPENDENCY_HOSTS)
  ─▶ install --frozen-lockfile --ignore-scripts
  ─▶ applyNetworkPolicy(deny_all)
  ─▶ next dev -H 0.0.0.0 -p 3000
  ─▶ loopback health probe until it answers
  ─▶ publicOrigin(3000)
```

Its own sandbox, running alongside validation rather than after it. The validation sandbox is untouched: no ports, `deny_all` before any repository-controlled command, exactly as ADR 0015 requires.

**What the preview claims changes with it.** It is no longer "the validated application is running". It is "the prepared code is running" — and *that* claim needs no build and no snapshot. The product says so wherever a preview is offered, in the confirmation and beside the running session, and a browser test pins the sentence.

**The `ValidatedArtifact` is switched off.** Nothing captures a snapshot, nothing restores one, nothing re-verifies a restored filesystem, and nothing keeps 24 hours of a customer's file tree at the provider. The columns and the historical rows stay; the capture step is gone.

**Two durable steps, not one.** `provisionPreview` (create → verify → scrub → install) and `startPreviewServer` (reconnect → dev server → health → origin). The split is forced from both sides: a `SandboxProcess` cannot survive a step boundary, so start and health check must share an invocation; and a large install must not share a step's ceiling with anything else.

**`preview-policy-v2`**, and the preview identity is now `[project, prepared change, prepared commit, profile, profile version, policy version]`. The commit is what was served, so the identity says what was served rather than naming a foreign key that implies it. The validation run is not in it — a preview no longer waits for one, and including it would produce two identities and two paid sandboxes for the same bytes either side of a check.

## Consequences

**A person can look immediately.** The button is available as soon as the change is prepared, which is the whole point: the five-minute check runs while they scroll.

**Nothing about approval moves.** Validation remains a hard gate on approving, and a preview does not soften it. Looking earlier is not deciding earlier.

**The three things `next dev` costs, stated rather than discovered.** The first request compiles, so the health probe pays that latency and the budget is 180s rather than 90s. A broken page renders Next's error overlay instead of a white screen — better for a preview, and a different artifact from what production would serve. `NODE_ENV=development`, so any code branching on it behaves as it does on a developer's machine.

**No auto-start.** ADR 0016 §4's server-side confirmation and CLAUDE.md rule 60 are untouched: a preview is a paid sandbox and it starts because a person asked.

**What was given up.** A preview is no longer a preview *of the checked build*, and cannot be described as one. That is a real loss and the copy is what carries it; nowhere in the product may a preview be labelled validated, checked or safe.

**The dogfood question this ADR does not answer.** Three assumptions here are reasoned rather than observed: that `next dev` starts under `deny_all` with an exposed port, that the first-request compile fits 180 seconds, and that the public route for port 3000 exists without a prior build. One real run answers all three or none.
