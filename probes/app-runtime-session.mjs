import assert from "node:assert/strict"
import { after, afterEach, before, describe, test } from "node:test"

import { issueInvoice, seed } from "../kernel/http/plugins-http.test-support.ts"
import { exchange, startKernel } from "./app-runtime-fixture.mjs"
import { assertEdgeHeaders, json, productionEnvironment, proxied, publicOrigin, refused, sessionCookie } from "./app-runtime-expect.mjs"

/**
 * The real kernel over HTTP, as in `app-runtime.mjs`: one browser session from
 * login to logout. The tests run in order on that session; the last one logs out.
 */

void describe("production kernel: session lifecycle and downloads", { timeout: 120_000 }, () => {
  let kernel
  let opened
  let cookie
  let csrfToken
  const send = (options) => exchange(kernel.port, { ...options, headers: { ...proxied, ...options.headers } })
  const write = { path: "/api/document-series", method: "POST", body: { documentType: "invoice", series: "RT" } }

  before(async () => {
    kernel = await startKernel("app_runtime_session", productionEnvironment)
    opened = await send({ path: "/api/session", method: "POST", body: { token: kernel.token }, headers: { ...json, origin: publicOrigin } })
    assert.equal(opened.status, 200, JSON.stringify(opened.body))
    cookie = sessionCookie(opened).split(";", 1)[0]
    csrfToken = opened.body.csrfToken
  })
  afterEach((t) => { if (!t.passed) console.error(kernel?.output()) })
  after(async () => { await kernel?.close() })

  void test("login answers a Secure, HttpOnly, Strict cookie on /api, and the session resumes", async () => {
    const setCookie = sessionCookie(opened)
    assert.match(setCookie, /^qwbe_session=[A-Za-z0-9_-]{43}; /u)
    for (const attribute of ["Path=/api", "HttpOnly", "SameSite=Strict", "Secure"]) {
      assert.ok(setCookie.split("; ").includes(attribute), `${attribute} in ${setCookie}`)
    }
    assert.equal(typeof csrfToken, "string")
    const resumed = await send({ path: "/api/session", headers: { cookie } })
    assert.deepEqual([resumed.status, resumed.body.authenticated], [200, true])
    assert.equal(resumed.headers["cache-control"], "no-store")
  })

  void test("a write without the CSRF token, or with a wrong one, is refused", async () => {
    refused(await send({ ...write, headers: { ...json, cookie, origin: publicOrigin } }), 403, "csrf_validation_failed", "write without CSRF")
    refused(await send({ ...write, headers: { ...json, cookie, origin: publicOrigin, "x-csrf-token": `${csrfToken}x` } }), 403,
      "csrf_validation_failed", "write with a wrong CSRF token")
  })

  void test("an issued invoice downloads as PDF and as e-Factura XML", async () => {
    const call = async (method, path, body, key) => {
      const headers = { cookie, origin: publicOrigin, ...(method === "GET" ? {} : { ...json, "x-csrf-token": csrfToken }),
        ...(key === undefined ? {} : { "idempotency-key": key }) }
      const reply = await send({ method, path, headers, body })
      return { status: reply.status, type: reply.headers["content-type"] ?? "", body: reply.body }
    }
    await seed({ call })
    const id = String((await issueInvoice(call, "runtime-issue-1")).id)
    assert.equal((await call("POST", `/api/invoices/${id}/pdf`, {})).status, 200)
    const pdf = await send({ path: `/api/invoices/${id}/pdf`, headers: { cookie } })
    assert.equal(pdf.status, 200)
    assert.equal(pdf.headers["content-type"], "application/pdf")
    assert.equal(pdf.headers["content-disposition"], `attachment; filename="invoice-${id.replace(/[^A-Za-z0-9_-]/gu, "_")}.pdf"`)
    assert.equal(pdf.raw.subarray(0, 5).toString("latin1"), "%PDF-")
    assertEdgeHeaders(pdf, "pdf")
    const xml = await send({ path: `/api/invoices/${id}/efactura.xml`, headers: { cookie } })
    assert.equal(xml.status, 200, xml.body)
    assert.equal(xml.headers["content-type"], "application/xml")
    assert.match(xml.headers["content-disposition"], /^attachment; filename="[A-Za-z0-9_-]+\.xml"$/u)
    assert.match(xml.body, /^<\?xml version="1\.0" encoding="UTF-8"\?>\s*<Invoice /u)
    assert.match(xml.body, /urn:cen\.eu:en16931:2017#compliant#urn:efactura\.mfinante\.ro:CIUS-RO:1\.0\.1/u)
    assertEdgeHeaders(xml, "xml")
  })

  void test("Swagger with the session: its own CSP, every other edge header", async () => {
    const docs = await send({ path: "/api", headers: { cookie } })
    assert.equal(docs.status, 200)
    assert.match(docs.body, /SwaggerUIBundle/u)
    // The Swagger bundle is inline, so this one page relaxes script and style only.
    assert.match(docs.headers["content-security-policy"], /^default-src 'none'; script-src 'unsafe-inline'; .*frame-ancestors 'none'/u)
    assertEdgeHeaders(docs, "docs", null)
  })

  void test("after logout the old cookie is worth nothing", async () => {
    const closed = await send({ path: "/api/session", method: "DELETE", headers: { cookie, origin: publicOrigin, "x-csrf-token": csrfToken } })
    assert.equal(closed.status, 200)
    assert.match(sessionCookie(closed), /^qwbe_session=; .*Max-Age=0/u)
    const replay = await send({ path: "/api/session", headers: { cookie } })
    assert.equal(replay.status, 401)
    assertEdgeHeaders(replay, "replay")
    assert.equal((await send({ path: "/api/customers", headers: { cookie } })).status, 401)
    assert.equal((await send({ path: "/api", headers: { cookie } })).status, 303)
    const replayedWrite = await send({ ...write, headers: { ...json, cookie, origin: publicOrigin, "x-csrf-token": csrfToken } })
    assert.equal(replayedWrite.status, 401, JSON.stringify(replayedWrite.body))
  })
})
