# lib/env

Central, validated environment access. See `env.ts` for the rationale: only `NEXT_PUBLIC_`-prefixed variables are validated here, because Sprint 0 introduces no server-only secrets. When one is introduced (GitHub App private key, Anthropic API key, webhook secrets, ...), validate it in a new module guarded by `import "server-only"` at the top — never add it to `env.ts`.

Required variables are documented in [.env.example](../../../.env.example).
