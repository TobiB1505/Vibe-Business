# modules/execution

AI Execution Layer, Git Branch/Change Layer, and Build & Validation Layer — see [ARCHITECTURE.md §3.6–§3.8](../../../ARCHITECTURE.md#36-ai-execution-layer). Prepares code changes on isolated branches and validates them, per [ADR 0005](../../../docs/decisions/0005-ai-provider-abstraction.md) and [ADR 0006](../../../docs/decisions/0006-untrusted-repository-execution.md).

**Sprint 0 status:** boundary reserved only. No Anthropic API calls, no agent loops, no branch creation, no builds/tests of third-party repositories, and no execution of any kind. ADR 0006 (untrusted repository code must run only in an isolated, ephemeral environment) is strictly respected: nothing in this module clones, installs, or executes third-party repository code — because nothing in this module does anything yet.
