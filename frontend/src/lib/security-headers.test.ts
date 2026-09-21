import assert from "node:assert/strict"
import test from "node:test"

import { contentSecurityPolicy, createNonce, securityHeaders } from "./security-headers.ts"

void test("builds a nonce CSP without production script relaxations", () => {
  const nonce = createNonce(() => "12345678-abcd-4000-8000-123456789abc")
  assert.equal(nonce, "12345678abcd40008000123456789abc")
  const policy = contentSecurityPolicy(nonce, false)
  assert.match(policy, /script-src 'self' 'nonce-12345678abcd40008000123456789abc'/)
  assert.match(policy, /style-src 'self' 'nonce-12345678abcd40008000123456789abc'/)
  assert.match(policy, /base-uri 'none'/)
  assert.match(policy, /form-action 'self'/)
  assert.match(policy, /frame-ancestors 'none'/)
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/)
})

void test("keeps legacy response headers and limits unsafe-eval to development", () => {
  const headers = securityHeaders("nonce", true)
  assert.match(headers["content-security-policy"] ?? "", /'unsafe-eval'/)
  assert.equal(headers["cross-origin-opener-policy"], "same-origin")
  assert.equal(headers["permissions-policy"], "camera=(), microphone=(), geolocation=()")
  assert.equal(headers["referrer-policy"], "no-referrer")
  assert.equal(headers["x-content-type-options"], "nosniff")
})
