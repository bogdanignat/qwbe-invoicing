import { runtimeProxyConfig } from "../src/lib/server/config.ts"

// The same validator used by route handlers runs before the standalone server
// starts listening. No credential or upstream connection is needed at build time.
runtimeProxyConfig()
