# 0095 - Design tooling is repo-native, and a registry cannot reach Vibe's primitives

Status: Accepted — amended in part by [ADR 0101](0101-icon-paths-come-from-lucide-the-frame-stays-vibes.md), which narrows the icon rule: still no icon package and no catalogue import in a component, but common marks are now Lucide path data generated into Vibe's own frame rather than hand-drawn. Everything else here stands.
Date: 2026-09-05

Introduces `components.json`, `.mcp.json` and `.claude/skills/` as tracked files. Changes no application code, adds no runtime dependency, and installs no component.

## Context

UI work in this repository depended on knowledge that existed only on one laptop: which catalogues to search, which of them Vibe's rules actually permit, how to port a component without breaking `cn`, and an MCP configuration that lived in an untracked file. A clone had none of it. Claude Code running remotely had none of it.

Three specific things were wrong.

**`.claude/` was ignored wholesale.** The comment gave the reason — the agent worktrees under it are full checkouts with `node_modules`, and the set had reached 5 GB, so `git add -A` had to not see them. That reason is about `.claude/worktrees/`, and the pattern covered the whole directory. Nothing under `.claude/` could ever be repo-native.

**The MCP configuration was untracked and carried a live secret.** `/.mcp.json` in the working copy held a 21st.dev API key in plaintext. It had never been committed — verified against every commit on every ref — but it was one `git add` from being permanent, and it did not travel, so a remote environment had no MCP at all.

**`DESIGN.md` forbade the file that discovery needs.** It said, correctly for the time, "There is no `components.json`", and: *don't let a registry install command scaffold a second `ui/` convention*. The shadcn MCP resolves namespaced registries out of `components.json` and cannot search `@magicui` or `@coss` without one.

## Decision

### The rule was about the aliases, not the file

`components.json` writes nothing. `shadcn add` writes, and where it writes is `aliases`. So the file is authored deliberately with every CLI-writable path pointed at `src/components/vendor/` — gitignored, imported by nothing:

```
components  @/components/vendor
ui          @/components/vendor/ui
lib         @/components/vendor/lib
hooks       @/components/vendor/hooks
utils       @/components/vendor/lib/utils
```

`src/components/ui/` is now **unreachable by an install command**. Verified with `shadcn info`, which prints the resolved absolute paths. This is a stronger guarantee than the prohibition it replaces: the old rule asked a person to remember, and this one makes the hand-written primitives unaddressable.

`vendor/` is a reading room. Third-party source lands there to be read and ported by hand into `src/components/`. Nothing vendored is committed and nothing there is imported.

`shadcn init` stays forbidden, and the reason sharpens: it would rewrite these aliases.

### `.gitignore` names the machine-specific half

`.claude/worktrees/`, `.claude/settings.local.json`, `.claude/*.local.json`, `.claude/mcp.env`. `.claude/skills/` travels with the clone.

### Secrets are environment variables, and only three exist

`.mcp.json` is committed carrying `${API_KEY_21ST}`, `${REUI_PAT_TOKEN}` and — in `components.json` — `${REUI_LICENSE_KEY}`. No value.

### Registries are configured only where one was verified to exist

Seven namespaces, each fetched before it was written down. Two sources the brief assumed were live are not:

- **Origin UI is now COSS.** `originui.com` redirects to `coss.com/ui` and the library was rebuilt on Base UI. The old `@originui` URL serves HTML. `@coss` is configured; `@originui` is not.
- **Jolly UI is offline.** Every path returns HTTP 402 `DEPLOYMENT_DISABLED`. No namespace is configured, because an entry pointing at a dead host produces a broken command rather than a missing feature.

Both are recorded in their skills with the command to re-check.

### Fourteen skills, layered

`ui-design-system` governs; `component-sourcing` and `motion-design` carry the shared procedure; `ui-audit` is read-only; ten source skills say what each catalogue is for and what it must not do. Detail sits in referenced files rather than in `SKILL.md`, so the recurring context cost stays small.

## Consequences

A clone has the toolkit. A remote Claude Code session has it too, needing only environment variables — the shadcn MCP is stdio and runs wherever the session runs.

`DESIGN.md`'s sentence "There is no `components.json`" is now false and is retired in `RETIRED_CLAIMS`, scoped to that file. History may still quote it.

Three sources are reachable only with a credential: 21st.dev, and ReUI twice over — a free account token for its MCP and a licence key for registry items. Without them those sources degrade to public documentation, which the skills say explicitly rather than leaving an agent to report a component it could not read.

What this does **not** do: install a component, add a dependency, or change a pixel. It also does not make the catalogues safe — `@aceternity`'s health was already `degraded` and two others rate-limited during verification. The skills record status and the command to re-verify, because a registry index is a live fact and this document is not.
