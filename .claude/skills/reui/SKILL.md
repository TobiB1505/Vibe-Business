---
name: ReUI
description: Search ReUI's registry through its MCP for application-grade components — data tables, forms, dashboard blocks, charts and AI chat blocks — with scored intent-based search and real component APIs. Use for application structure and dense data UI, after checking Vibe's own inventory and shadcn primitives. Requires REUI_PAT_TOKEN for the MCP and REUI_LICENSE_KEY for item downloads.
---

# ReUI

Read [ui-design-system](../ui-design-system/SKILL.md) and
[component-sourcing](../component-sourcing/SKILL.md) first.

Third in the hierarchy for **application structure**: existing Vibe → shadcn →
ReUI. Its strength is application-grade density — tables, forms, dashboard
blocks, charts — rather than marketing spectacle.

## Two credentials, and they are different

Conflating these produces a confusing 401.

| Credential | Reaches | Cost |
|---|---|---|
| `REUI_PAT_TOKEN` | The **MCP** at `https://mcp.reui.io` | Free with a ReUI account |
| `REUI_LICENSE_KEY` | **Registry item downloads** at `reui.io/r/…` | Licensed |

The registry **index** (`https://reui.io/r/registry.json`) is public. Individual
items are not: without a licence key they return
`401 Provide your license key via Authorization header`.

Tokens are personal, carry your plan, and expire (90 days by default). An expired
one simply starts returning 401 — regenerate at Account → MCP.

**With neither**, ReUI degrades to reading the public docs and index. That is a
usable fallback. Say which mode you are in rather than reporting a component you
could not actually read.

## Use it for

Data tables (sorting, selection, pagination), form composition and validation,
dashboard blocks, chart components, AI chat blocks, and command interfaces.

## Official agent skill

ReUI publishes its own Claude Code skill via a one-line installer. It is **not
installed here** — inspect what it writes before adding it, and if it lands,
this file stays the authority: ReUI's own skill will describe installing ReUI
components directly into a project, which is not what happens here. Ports go
through `src/components/vendor/` and into Vibe by hand.

## Porting

ReUI is Radix-based and ships `cva` variants. Neither exists here — see
[adaptation.md](../component-sourcing/adaptation.md). A ReUI data table is
usually worth taking for its **behaviour**, and rarely for its markup.

## Do not

- Commit a licence key or a PAT. `.mcp.json` carries `${VAR}` only.
- Claim a component's API without having read it.
- Import from `src/components/vendor/`.
