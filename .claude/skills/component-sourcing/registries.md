# Configured sources, and how each is reached

Verified 2026-09-05 against the official shadcn registry index
(`https://ui.shadcn.com/r/registries.json`) and by direct request. Re-verify
before trusting a status here — registries move, and two of these already have.

## MCP servers — `.mcp.json`

| Server | Transport | Auth | Env var |
|---|---|---|---|
| `shadcn` | stdio, `npx shadcn@latest mcp` | none | — |
| `21st` | http, `https://21st.dev/api/mcp` | `x-api-key` | `API_KEY_21ST` |
| `reui` | http, `https://mcp.reui.io` | `Authorization: Bearer` | `REUI_PAT_TOKEN` |

The shadcn MCP reads `components.json`, so every namespace below is reachable
through it — no extra server per source.

## Registry namespaces — `components.json`

| Namespace | URL | Verified |
|---|---|---|
| `@magicui` | `https://magicui.design/r/{name}` | 250 items |
| `@aceternity` | `https://ui.aceternity.com/registry/{name}.json` | 278 items |
| `@coss` | `https://coss.com/ui/r/{name}.json` | 577 items |
| `@kokonutui` | `https://kokonutui.com/r/{name}.json` | 51 items |
| `@cult-ui` | `https://cult-ui.com/r/{name}.json` | in index; rate-limited (429) at verification |
| `@motion-primitives` | `https://motion-primitives.com/c/{name}.json` | in index; rate-limited (429) at verification |
| `@reui` | `https://reui.io/r/{style}/{name}.json` | index public; **items need a licence key** |

A 429 is throttling, not absence. During verification `cult-ui.com` returned 429 for its
**homepage** as well as its registry, which places the limit at the network the request came
from rather than at the registry. Retry from elsewhere or later; do not "fix" it by changing
the URL. Both namespaces are listed and monitored in the official shadcn index.

## Two sources that are not what the brief assumed

**Origin UI is now COSS.** `originui.com` redirects to `https://coss.com/ui`, and
the library was rebuilt on **Base UI** rather than Radix. The old `@originui`
namespace URL serves HTML, so it is *not* configured — `@coss` is. Legacy Origin
UI still exists but is unmaintained. See [origin-ui](../origin-ui/SKILL.md).

**Jolly UI is down.** Every `jollyui.dev` path returns HTTP 402
`DEPLOYMENT_DISABLED`. No namespace is configured, because configuring one would
produce a broken install rather than a missing feature. shadcn's own React Aria
support is the live path. See [jolly-ui](../jolly-ui/SKILL.md).

## Two credentials for ReUI, not one

They are different things and are easy to conflate:

- `REUI_PAT_TOKEN` — the **MCP** server. Free with a ReUI account.
- `REUI_LICENSE_KEY` — **registry item downloads**. `reui.io/r/…` returns
  401 `Provide your license key` without it. The index is public; the items are not.

Without either, ReUI degrades to reading the public docs — which is a usable
fallback, not a failure.

## No MCP of their own

Magic UI, Aceternity, Kokonut, Cult, Motion Primitives and COSS publish **shadcn
registries**, not MCP servers. Reach them through the shadcn MCP or the CLI. Do
not invent an MCP endpoint for one.

## Adding a namespace later

1. Find it in `https://ui.shadcn.com/r/registries.json` — that index carries a
   health status, which is the honest signal.
2. Add it to `registries` in `components.json`.
3. Verify: `pnpm dlx shadcn@latest search @<ns> --limit 3`.
4. Never add one whose URL you have not fetched.
