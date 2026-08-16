import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicEnv } from "@/lib/env/anthropic";
import { AnthropicProvider } from "./adapter";
import type { AIProvider } from "../provider";

/**
 * Constructs the configured Anthropic provider (ADR 0008).
 *
 * `server-only` and lazy env parsing together mean the API key is read at
 * the moment an audit actually runs — never at import time, never during a
 * build, and never in a client bundle.
 */

let cached: AIProvider | undefined;

export function getAIProvider(): AIProvider {
  if (cached) return cached;

  const env = getAnthropicEnv();
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    // One audit is one call. The SDK's default retry behaviour would turn a
    // rate limit into several billable attempts and blur usage accounting,
    // so retries are handled as an explicit product decision (currently:
    // not at all) rather than silently by the transport.
    maxRetries: 0,
    // A backstop only. Every request overrides this from its operation's
    // `timeoutMs`, because how long is too long depends on the task: the audit
    // reasons through nine lenses in roughly two minutes, Product Understanding
    // extracts structure in ten seconds. This value used to be the only one,
    // and it silently discarded a complete audit at 120,003ms.
    timeout: 120_000,
  });

  cached = new AnthropicProvider(client.messages);
  return cached;
}

/** Test-only: clears the cached provider. */
export function __resetAIProviderCacheForTests(): void {
  cached = undefined;
}
