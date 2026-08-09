# 0008 - Secrets Management

Status: Accepted
Date: 2026-08-09

## Context

Vibe Business handles multiple sensitive credentials (GitHub App private key, Supabase service credentials, Anthropic API key, webhook secrets). [CLAUDE.md](../../CLAUDE.md) already requires least privilege for security-sensitive integrations and forbids committing secrets. [ARCHITECTURE.md](../../ARCHITECTURE.md) left the concrete secrets management approach as an open decision.

## Decision

V0.1 uses **server-side environment/secret management provided by the hosting environment**. Concretely, for V0.1: **Vercel Environment Variables / Secret Configuration**, consistent with hosting on Vercel per [0004](0004-vercel-as-initial-host-and-preview-provider.md).

Applies to secrets such as:

- GitHub App private key
- GitHub App secret
- Supabase service credentials
- Anthropic API key
- Webhook secrets

Secrets must **never**:

- Be committed to the Git repository
- Be sent to client components
- Be stored in public environment variables
- Be written to normal application logs
- Be included in AI prompts, unless absolutely unavoidable and specifically designed to be safe
- Be stored unencrypted as plain application/database fields

Provider- or user-level credentials that may need to be persisted later (e.g. a user's own third-party credentials, if ever required) need a **separate, dedicated secrets design** and must not be implemented as plaintext database columns. That design is out of scope for this ADR and V0.1.

## Consequences

### Positive

- Using the hosting platform's built-in secret storage avoids introducing a separate secrets-management provider for V0.1.
- Explicit "never" list gives implementation sessions (see [CLAUDE.md](../../CLAUDE.md)) a concrete, checkable boundary rather than a vague "be careful with secrets."

### Negative / Tradeoffs

- Vercel Environment Variables are simple but offer less lifecycle control (rotation, fine-grained access policies, audit trail on secret access) than a dedicated secrets manager.
- Any future persisted third-party/user credentials require additional design work not covered here — this ADR intentionally does not solve that case.

## Revisit when

Vibe Business needs to persist third-party or user-supplied credentials beyond the platform's own service credentials, or compliance/operational requirements exceed what host-provided environment variables can support.
