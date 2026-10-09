import assert from "node:assert/strict"
import test from "node:test"

import { decodeProxyConfig, type ProxyConfig } from "./config.ts"
import { handleApiDocsRequest } from "./proxy-docs.ts"

const config = (upstream = "http://backend:3000"): ProxyConfig =>
  decodeProxyConfig({ FRONTEND_ORIGIN: "https://invoice.test", INVOICING_API_URL: upstream })

const stub = (response: () => Response) => {
  const paths: Array<string> = []
  const forward = (_request: Request, _config: ProxyConfig, path: string): Promise<Response> => {
    paths.push(path)
    return Promise.resolve(response())
  }
  return { paths, forward }
}

const request = (method = "GET", url = "https://invoice.test/api/qwbe/docs") => new Request(url, { method })

void test("asks the backend for its docs page at the fixed path, never one taken from the URL", async () => {
  const upstream = stub(() => new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }))
  await handleApiDocsRequest(request("GET", "https://invoice.test/api/qwbe/docs?x=../../admin"), config(), upstream.forward)
  await handleApiDocsRequest(request(), config("http://backend:3000/internal/"), upstream.forward)
  assert.deepEqual(upstream.paths, ["/api", "/internal/api"])
})

void test("serves the page with the backend's own strict policy", async () => {
  const upstream = stub(() => new Response("<html></html>", { headers: { "content-type": "text/html; charset=utf-8" } }))
  const response = await handleApiDocsRequest(request(), config(), upstream.forward)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  const policy = response.headers.get("content-security-policy") ?? ""
  assert.match(policy, /frame-ancestors 'none'/u)
  assert.match(policy, /connect-src 'self'/u)
  assert.match(policy, /default-src 'none'/u)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("referrer-policy"), "no-referrer")
  assert.equal(await response.text(), "<html></html>")
})

void test("sends a caller without a session to the login page, keeping the cookie the backend clears", async () => {
  const cleared = "qwbe_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0"
  const upstream = stub(() => new Response(JSON.stringify({ error: "AuthenticationRequired" }), {
    status: 401, headers: { "content-type": "application/json", "set-cookie": cleared },
  }))
  const response = await handleApiDocsRequest(request(), config(), upstream.forward)
  assert.equal(response.status, 303)
  assert.equal(response.headers.get("location"), "/unlock")
  assert.deepEqual(response.headers.getSetCookie(), [cleared])
  assert.equal(response.headers.get("cache-control"), "no-store")
})

void test("answers only GET, without asking the backend", async () => {
  const upstream = stub(() => new Response("unexpected"))
  for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
    const response = await handleApiDocsRequest(request(method), config(), upstream.forward)
    assert.equal(response.status, 405, method)
    assert.equal(response.headers.get("allow"), "GET", method)
  }
  assert.deepEqual(upstream.paths, [])
})

void test("passes a backend that is not ready through unchanged, still under the policy", async () => {
  const upstream = stub(() => new Response(JSON.stringify({ error: "not_ready" }), { status: 503, headers: { "content-type": "application/json" } }))
  const response = await handleApiDocsRequest(request(), config(), upstream.forward)
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: "not_ready" })
  assert.match(response.headers.get("content-security-policy") ?? "", /default-src 'none'/u)
})
