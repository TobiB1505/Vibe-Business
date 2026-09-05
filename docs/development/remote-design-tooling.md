# Remote design tooling

How UI work runs from a clone — including a remote Claude Code session — without
depending on anything installed on one laptop. The decision is
[ADR 0095](../decisions/0095-design-tooling-is-repo-native.md); the design
authority is [DESIGN.md](../../DESIGN.md).

This is a **current-state** document: it must be true at HEAD.

## What works from a clone, with nothing configured

| Path | What it gives |
|---|---|
| `.claude/skills/` | Fourteen skills: the governing design system, sourcing, motion, audit, and ten source-specific skills |
| [CLAUDE.md](../../CLAUDE.md) § UI / Design Tooling | Rule 85 and the sourcing hierarchy |
| [DESIGN.md](../../DESIGN.md) | The design authority |
| `components.json` | Seven registry namespaces, and the aliases that quarantine every install |
| `.mcp.json` | Three MCP servers, secrets as `${VAR}` only |

Skills, registry namespaces and the sourcing rules need **no credential at all**.
The shadcn MCP is stdio (`npx shadcn@latest mcp`) and runs wherever the session
runs, so it works remotely with nothing to configure.

Four registries are reachable unauthenticated: `@magicui`, `@aceternity`,
`@kokonutui`, `@coss`. Two more — `@cult-ui`, `@motion-primitives` — are
unauthenticated but were rate-limited (HTTP 429) at verification.

## Environment variables

Names only. Never commit a value; never write one into `.mcp.json` or
`components.json`.

| Variable | Reaches | Obtained from | Without it |
|---|---|---|---|
| `API_KEY_21ST` | The `21st` MCP | `21st.dev/settings/api-keys` | 21st.dev is unreachable; every other source still works |
| `REUI_PAT_TOKEN` | The `reui` MCP | ReUI → Account → MCP. Free with an account | ReUI degrades to its public docs and index |
| `REUI_LICENSE_KEY` | `@reui` registry **item downloads** | A ReUI licence | The index reads; individual items return 401 |

The two ReUI credentials are different things. The MCP token is free and
authenticates the server; the licence key authorises fetching component source.
`https://reui.io/r/registry.json` is public either way.

PATs expire — 90 days by default. An expired one returns 401; regenerate it.

## Authentication mechanisms

| Integration | Mechanism |
|---|---|
| shadcn MCP | None |
| shadcn registry (`@shadcn`) | None |
| 21st.dev MCP | API key, `x-api-key` header |
| ReUI MCP | Bearer token — OAuth browser sign-in interactively, PAT headless |
| ReUI registry | Bearer licence key |
| Magic UI, Aceternity, Kokonut, Cult, Motion Primitives, COSS | None |

## Setting the variables

### Remote / CI

Set them in the environment the session runs in — the host's secret store. Claude
Code substitutes `${VAR}` in a server's `url` and `headers` at launch.

### Local

`.claude/mcp.env` is gitignored for this. Create it and source it **before**
launching Claude Code — substitution happens at startup, so a variable exported
afterwards is not picked up:

```bash
set -a; source .claude/mcp.env; set +a
```

```
# .claude/mcp.env — never committed
API_KEY_21ST=…
REUI_PAT_TOKEN=…
REUI_LICENSE_KEY=…
```

Interactively, ReUI can also be authorised by OAuth: the first connection opens a
"Sign in with ReUI" approval in a browser. That path does **not** work headlessly
— use the PAT there.

## Remote limitations

- **ReUI OAuth needs a browser.** Headless environments must use
  `REUI_PAT_TOKEN`.
- **21st.dev retrievals and generations are metered.** Do not spend credits
  unless asked.
- **Two registries were rate-limited at verification** (`@cult-ui`,
  `@motion-primitives`). `cult-ui.com` returned 429 for its homepage too, which places the
  limit at the requesting network rather than at the registry — a misconfiguration would not
  do that. Retry from elsewhere or later; do not edit the URL. Both are listed and monitored
  in the official shadcn registry index.
- **`@aceternity` was `degraded`** in the official shadcn registry index. Expect
  occasional failures.
- **Jolly UI is offline** — every path returns HTTP 402 `DEPLOYMENT_DISABLED`, so
  no `@jolly` namespace is configured. See
  `.claude/skills/jolly-ui/SKILL.md` for the re-check command.
- **Visual verification needs a browser.** The Browser pane covers it in Claude
  Code; a pure-CLI environment can run `pnpm test:e2e` but cannot look at a
  screen. Do not report a visual change as verified without having seen it.

## Verifying the setup

```bash
pnpm dlx shadcn@latest info                              # aliases resolve into vendor/
pnpm dlx shadcn@latest search @magicui --limit 3         # a registry answers
```

`shadcn info` should print every alias under `src/components/vendor/`. If any
points at `src/components/ui`, the quarantine is broken — that is the property
ADR 0095 rests on.

In an interactive session, `/mcp` reports each server's connection state.

## What is deliberately not here

- **No component is installed.** The toolkit is discovery; adoption is a separate,
  argued decision.
- **No UI dependency was added.** No Radix, no icon package, no `clsx`, no
  `cva`, no `tailwind-merge`.
- **`src/components/vendor/` is not committed.** It is a reading room: source
  lands there to be read and ported by hand into `src/components/`.
