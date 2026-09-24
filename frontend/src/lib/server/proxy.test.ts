import assert from "node:assert/strict"
import test from "node:test"

import { decodeProxyConfig, type ProxyConfig } from "./config.ts"
import { proxyRequestHeaders, proxyResponseHeaders, validSessionSetCookie } from "./proxy-headers.ts"
import { mapProxyPath } from "./proxy-path.ts"

const config: ProxyConfig = {
  frontendOrigin: new URL("https://invoicing.example.test"),
  upstreamBase: new URL("http://127.0.0.1:3001/"),
  timeoutMs: 100,
}

void test("runtime config accepts only canonical public and fixed upstream URLs", () => {
  const decoded = decodeProxyConfig({
    FRONTEND_ORIGIN: "https://invoicing.example.test:8443",
    INVOICING_API_URL: "http://backend:3000/internal/",
  })
  assert.equal(decoded.frontendOrigin.origin, "https://invoicing.example.test:8443")
  assert.equal(decoded.upstreamBase.href, "http://backend:3000/internal")
  for (const environment of [
    { INVOICING_API_URL: "http://backend" },
    { FRONTEND_ORIGIN: "https://example.test/", INVOICING_API_URL: "http://backend" },
    { FRONTEND_ORIGIN: "https://example.test/path", INVOICING_API_URL: "http://backend" },
    { FRONTEND_ORIGIN: "https://example.test", INVOICING_API_URL: "http://user@backend" },
    { FRONTEND_ORIGIN: "https://example.test", INVOICING_API_URL: "http://backend?target=other" },
  ]) assert.throws(() => decodeProxyConfig(environment))
})

void test("raw proxy paths retain encoded IDs and query multiplicity but reject escapes", () => {
  assert.equal(mapProxyPath("https://invoicing.example.test/api/qwbe/customers/customer%2F1?a=1&a=2&v=%25", config.upstreamBase),
    "/api/customers/customer%2F1?a=1&a=2&v=%25")
  for (const path of ["customers/customer%251", "product-presets/preset%251", "documents/document%251"]) {
    assert.equal(mapProxyPath(`https://invoicing.example.test/api/qwbe/${path}`, config.upstreamBase), `/api/${path}`)
  }
  for (const path of [
    "/api/qwbe", "/api/qwbe/", "/api/qwbe//evil", "/api/qwbe/%2e%2e/health", "/api/qwbe/%252e%252e/health",
    "/api/qwbe/customer%5cadmin", "/api/qwbe/%zz", "/api/qwbe/x%2F..%2F..%2Fhealth%2Flive",
    "/api/qwbe/..%2Fhealth", "/api/qwbe/%00", "/api/qwbe/%2525252e%2525252e/health",
  ]) assert.equal(mapProxyPath(`https://invoicing.example.test${path}`, config.upstreamBase), undefined, path)
})

void test("request headers enforce public trust boundary and isolate the session cookie", () => {
  const valid = new Request("https://invoicing.example.test/api/qwbe/customers", { headers: {
    host: "invoicing.example.test", cookie: "theme=dark; qwbe_session=opaque", "x-forwarded-host": "invoicing.example.test",
    "x-forwarded-proto": "https", authorization: "",
  } })
  assert.deepEqual(proxyRequestHeaders(valid, config), { ok: false, status: 400, error: "authorization_not_allowed" })
  for (const [headers, error] of [
    [{ host: "foreign.example.test" }, "invalid_host"],
    [{ host: "invoicing.example.test", "x-forwarded-host": "foreign.example.test" }, "invalid_forwarded_headers"],
    [{ host: "invoicing.example.test", "x-forwarded-proto": "http" }, "invalid_forwarded_headers"],
    [{ host: "invoicing.example.test", "x-forwarded-host": "invoicing.example.test,foreign.example.test" }, "invalid_forwarded_headers"],
  ] as const) {
    const result = proxyRequestHeaders(new Request("https://invoicing.example.test/api/qwbe/session", { headers }), config)
    assert.deepEqual(result, { ok: false, status: 400, error })
  }
  for (const cookie of ["qwbe_session=", "qwbe_session=first; qwbe_session=second", "qwbe_session=first, qwbe_session=second",
    "qwbe_session=; qwbe_session=second"]) {
    const result = proxyRequestHeaders(new Request("https://invoicing.example.test/api/qwbe/session", {
      headers: { host: "invoicing.example.test", cookie },
    }), config)
    assert.deepEqual(result, { ok: false, status: 400, error: "invalid_session_cookie" })
  }
  for (const origin of [undefined, "null", "https://foreign.example.test"]) {
    const foreign = proxyRequestHeaders(new Request("https://invoicing.example.test/api/qwbe/session", {
      method: "POST", headers: { host: "invoicing.example.test", ...(origin === undefined ? {} : { origin }) }, body: "{}",
    }), config)
    assert.deepEqual(foreign, { ok: false, status: 403, error: "origin_not_allowed" })
  }
})

void test("only host-only secure session cookies satisfy the response contract", () => {
  const secure = `qwbe_session=${"a".repeat(43)}; Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
  const development = `qwbe_session=${"a".repeat(43)}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=2592000`
  assert.equal(validSessionSetCookie(secure), true)
  assert.equal(validSessionSetCookie(development), false)
  assert.equal(validSessionSetCookie(development, false), true)
  assert.equal(validSessionSetCookie(secure, false), true)
  assert.equal(validSessionSetCookie("qwbe_session=; Path=/api; HttpOnly; SameSite=Strict; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"), true)
  assert.equal(validSessionSetCookie("qwbe_session=; Path=/api; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"), true)
  for (const tampered of [secure.replace("Path=/api", "Path=/"), secure.replace("HttpOnly", "HttpOnly=yes"),
    secure.replace("SameSite=Strict", "SameSite=Lax"), secure.replace("Secure", "Secure=yes"),
    `${secure}; Domain=example.test`, `${secure}; Priority=High`, `${secure}; HttpOnly`]) {
    assert.equal(validSessionSetCookie(tampered), false, tampered)
  }
})

void test("a session cookie the contract rejects fails the response instead of disappearing from it", () => {
  const issued = `qwbe_session=${"a".repeat(43)}; Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=2592000`
  const clear = "qwbe_session=; Path=/api; HttpOnly; SameSite=Strict; Secure; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
  const rawHeaders = (...cookies: ReadonlyArray<string>) => cookies.flatMap((cookie) => ["Set-Cookie", cookie])
  const forwarded = (result: ReturnType<typeof proxyResponseHeaders>) =>
    result.ok ? result.headers.getSetCookie() : undefined

  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(issued), true)), [issued])
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(clear), true)), [clear])

  // A cookie that never claimed the session name was never ours to forward.
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders("theme=dark; Path=/"), true)), [])
  // Neither is one that only looks like it: the name is matched case-sensitively.
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(issued.replace("qwbe_session", "QWBE_SESSION")), true)), [])
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(issued.replace("qwbe_session", "qwbe_session_x")), true)), [])

  for (const [name, cookies] of [
    ["tampered path", [issued.replace("Path=/api", "Path=/")]],
    ["tampered SameSite", [issued.replace("SameSite=Strict", "SameSite=Lax")]],
    ["host-wide domain", [`${issued}; Domain=example.test`]],
    ["malformed value", ["qwbe_session=short; Path=/api; HttpOnly; SameSite=Strict; Secure; Max-Age=60"]],
    ["insecure issue on an https origin", [issued.replace("; Secure", "")]],
    ["two issued sessions", [issued, issued]],
    ["an issue beside a clear", [issued, clear]],
    ["a valid cookie followed by a rejected one", [issued, issued.replace("Path=/api", "Path=/")]],
    // Padding before `=` is a malformed session cookie, not a foreign one: it must
    // fail the response rather than vanish from a 200 that promises a session.
    ["space before the name separator", [issued.replace("qwbe_session=", "qwbe_session =")]],
    ["tab before the name separator", [issued.replace("qwbe_session=", "qwbe_session\t=")]],
    ["padded name beside a valid cookie", [issued, issued.replace("qwbe_session=", "qwbe_session =")]],
  ] as const) {
    assert.deepEqual(proxyResponseHeaders({}, rawHeaders(...cookies), true),
      { ok: false, error: "invalid_upstream_cookie" }, name)
  }

  // Off an https origin the clear cookie is still honoured, normalized to Secure.
  const insecureClear = clear.replace("; Secure", "")
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(insecureClear), true)), [`${insecureClear}; Secure`])
  assert.deepEqual(forwarded(proxyResponseHeaders({}, rawHeaders(issued.replace("; Secure", "")), false)),
    [issued.replace("; Secure", "")])
})
