import assert from "node:assert/strict"
import { URL } from "node:url"

/**
 * What the runtime probes expect at the edge, shared by `app-runtime.mjs` and
 * `app-runtime-session.mjs`. The headers are written out here rather than imported
 * from `kernel/http/security-headers.ts`: a change to them has to change the probe too.
 */

export const strictCsp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; "
  + "font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"

export const publicOrigin = "https://invoice.runtime.test"
// What the TLS proxy in front of the kernel adds; optional, but checked when present.
export const proxied = { host: new URL(publicOrigin).host, "x-forwarded-proto": "https" }
export const json = { "content-type": "application/json" }
export const productionEnvironment = { NODE_ENV: "production", PUBLIC_ORIGIN: publicOrigin }

/** Every edge header; `csp: null` skips the CSP for a page that carries its own. */
export const assertEdgeHeaders = (reply, what, csp = strictCsp) => {
  if (csp !== null) assert.equal(reply.headers["content-security-policy"], csp, `${what}: CSP`)
  assert.equal(reply.headers["cross-origin-opener-policy"], "same-origin", `${what}: COOP`)
  assert.equal(reply.headers["permissions-policy"], "camera=(), microphone=(), geolocation=()", `${what}: Permissions-Policy`)
  assert.equal(reply.headers["referrer-policy"], "no-referrer", `${what}: Referrer-Policy`)
  assert.equal(reply.headers["x-content-type-options"], "nosniff", `${what}: nosniff`)
}

export const refused = (reply, status, error, what) => {
  assert.deepEqual([reply.status, reply.body], [status, { error }], what)
  assertEdgeHeaders(reply, what)
}

export const sessionCookie = (reply) => {
  const cookies = reply.headers["set-cookie"] ?? []
  assert.equal(cookies.length, 1, JSON.stringify(cookies))
  return cookies[0]
}
