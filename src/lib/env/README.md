# lib/env

Central, validated environment access.

- `env.ts` — public (`NEXT_PUBLIC_`-prefixed) variables, safe for both server and client code.
- `github.ts` — server-only GitHub App configuration, guarded by `import "server-only"`. Introduced in Sprint 1 for `src/modules/github/`. Validated lazily (only when a GitHub operation actually runs), so a normal build/CI run never needs real GitHub credentials.

When another server-only secret is introduced (Anthropic API key, webhook secrets, ...), validate it in its own `server-only`-guarded module here — never add it to `env.ts`.

Required variables are documented in [.env.example](../../../.env.example).
