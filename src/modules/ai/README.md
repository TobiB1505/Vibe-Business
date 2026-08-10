# ai

The AI provider boundary ([ADR 0005](../../../docs/decisions/0005-ai-provider-abstraction.md), [ADR 0011](../../../docs/decisions/0011-ai-inference-and-evidence-trust-boundary.md)) and everything that costs money.

```
provider.ts            AIProvider — domain-owned, no Anthropic types
operations.ts          model / effort / token budgets, per operation
pricing.ts             effective-dated pricing + integer-exact cost
usage.ts               internal provider-cost ledger (server-only)
anthropic/adapter.ts   the ONLY file that imports the Anthropic SDK
anthropic/client.ts    key loading + client construction (server-only)
```

## Non-negotiables

- **No tools, ever.** `StructuredRequest` has no field for tools, web search, URL fetching, or code execution, and the adapter must never add one. A model that receives untrusted evidence and cannot act is why prompt injection is a wrong sentence rather than an incident.
- **The SDK stops at the adapter.** Nothing outside `anthropic/` may import `@anthropic-ai/sdk`. Callers switch on `AIFailureCode`; a raw provider error must never reach a log line or a browser.
- **Translate provider failures, never flatten them.** Both call paths — free token counting and the billable call — classify errors from the HTTP status and the API's typed `error.type` field, never from message text. A catch-all that reports one generic code hides operator-actionable states such as an unpaid account; the generic codes (`token_count_failed`, `provider_unavailable`) are last resorts for failures that map onto no known state.
- **One code per stage, so a failure names its own cause.** A rejected request (`provider_request_rejected`), a response with no text (`structured_output_empty`), and unparseable text (`structured_output_json_invalid`) are three different bugs with three different fixes; the domain adds a fourth for its own post-validation. Sharing one code between them makes a production failure undiagnosable without spending another paid call.
- **Diagnostics are a closed set of identifiers, never prose.** `ProviderErrorDiagnostic` carries an HTTP status, the typed `error.type`, and a request id — each pattern-validated on the way in, so a provider returning a message where an identifier belongs gets it dropped. There is no field for a message, a body, a payload, a prompt, or evidence.
- **No reasoning leaves the adapter.** Only `text` blocks are read. Thinking token *counts* are read because they are billed; thinking *text* is never returned, stored, or displayed.
- **Every model identifier lives in `operations.ts`.** No route handler, action, or component may name a model, and nothing user-supplied may select one.
- **Every price lives in `pricing.ts`**, effective-dated, in integer nanodollars. No dollar constant belongs anywhere else, and floats have no place in a ledger.
- **The key is server-only.** `ANTHROPIC_API_KEY` is parsed lazily so build, tests and CI never need it.

## Adding an AI operation

1. Add an `AIOperation` and its `OperationConfig` (model, effort, budgets).
2. Build the request in the *domain* module that owns the task, not here.
3. Count tokens before calling; record usage after, success or failure.
4. Validate the response independently — schema compliance is not truthfulness.
