# modules/usage

Usage half of the Usage/Credit Layer — see [ARCHITECTURE.md §3.11](../../../ARCHITECTURE.md#311-usagecredit-layer). Records the per-AI-job usage schema from [PRODUCT.md §12](../../../PRODUCT.md#12-credit-model) (`provider`, `model`, `input_tokens`, `output_tokens`, `provider_cost`, `tool_cost`, `job_id`, `user_id`, `timestamp`).

**Reserved name, never used.** The usage layer was built elsewhere and in a different shape than this stub anticipated: one table could not hold it, because the units are not comparable.

| What is metered | Where it is recorded |
|---|---|
| Provider tokens and provider cost | `ai_usage_events` — written by [`modules/ai/usage.ts`](../ai) |
| Sandbox wall time, active CPU, egress | `sandbox_usage_events` |
| Deep Scan browser seconds | `deep_scan_provider_usage` |
| Visual review browser seconds | `review_browser_usage` |

Customer-facing Credits are a separate ledger again, in [`modules/credits`](../credits) — provider cost and Credits are deliberately different systems ([ADR 0024](../../../docs/decisions/0024-vibe-credits-economic-layer.md)).
