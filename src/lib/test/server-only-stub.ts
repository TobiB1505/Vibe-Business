// Test-only stand-in for the `server-only` package. The real package
// unconditionally throws on import — Next.js's bundler is what turns that
// into a client/server boundary check by swapping it out for server
// bundles. Under Vitest (plain Node, no Next.js bundler) that throw would
// fire for every server-only module, so vitest.config.mts aliases
// `server-only` to this no-op for tests only. Production code is
// unaffected — Next.js still resolves the real package.
export {};
