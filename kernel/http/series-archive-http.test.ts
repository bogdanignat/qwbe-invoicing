import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"

import { handleApiRequest } from "../api/api.test-support.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { anafRegistry } from "../company-lookup/vat-registry.test-support.ts"
import { allPlugins } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { customer, dueDate, issueDate, lines, ok, seed, serve } from "./plugins-http.test-support.ts"

/** T-2082 over HTTP: `PUT /api/document-series/{documentType}/{series}/archived`. */

const archivePath = (series: string, documentType = "invoice") => `/api/document-series/${documentType}/${series}/archived`
const invoiceSeries = (archived: boolean) => ({ organizationId: "org-1", documentType: "invoice", series: "QWBE", archived })
const settingsManage = "invoicing:settings.manage"

void test("archiving over a cookie session: CSRF, the settings permission, 400, 404 and the same state again", async () => {
  await withMigrated("series_archive_http", async (fixture) => {
    const served = await serve(fixture, allPlugins)
    const { call } = served
    try {
      await seed(served)
      const withoutCsrf = await fetch(`${served.origin}${archivePath("QWBE")}`, { method: "PUT",
        headers: { cookie: served.cookie, origin: served.origin, "content-type": "application/json" }, body: JSON.stringify({ archived: true }) })
      assert.equal(withoutCsrf.status, 403)
      assert.equal(((await withoutCsrf.json()) as { readonly error: string }).error, "csrf_validation_failed")
      assert.deepEqual(await ok(call("PUT", archivePath("QWBE"), { archived: true }), "archive"), invoiceSeries(true))
      assert.deepEqual(await ok(call("PUT", archivePath("QWBE"), { archived: true }), "archive again"), invoiceSeries(true))
      assert.deepEqual((await call("GET", "/api/document-series")).body, [
        invoiceSeries(true), { organizationId: "org-1", documentType: "proforma", series: "PRO", archived: false }])
      for (const body of [{ archived: "yes" }, { archived: 1 }, {}, []]) {
        assert.equal((await call("PUT", archivePath("QWBE"), body)).status, 400, JSON.stringify(body))
      }
      assert.equal((await call("PUT", archivePath("QWBE", "receipt"), { archived: true })).status, 400)
      assert.equal((await call("PUT", archivePath("lower"), { archived: true })).status, 400)
      assert.deepEqual(await call("PUT", archivePath("ZZZ"), { archived: true }).then(({ status, body }) => [status, body]),
        [404, { error: "ResourceNotFound" }])
      // Issuing into the archived series is a 409 with its own code; a draft on it moves to an active series.
      const refused = await call("POST", "/api/invoices", { customer, series: "QWBE", issueDate, dueDate, currency: "RON", lines }, "archived-1")
      assert.deepEqual([refused.status, (refused.body as { readonly code?: string }).code], [409, "document_series_archived"])
      await ok(call("PUT", archivePath("QWBE"), { archived: false }), "reactivate")
      const draft = await ok(call("POST", "/api/drafts", { customer, series: "QWBE", issueDate, dueDate, lines }, "draft-1"), "draft")
      await ok(call("POST", "/api/document-series", { documentType: "invoice", series: "NEW" }), "new series")
      await ok(call("PUT", archivePath("QWBE"), { archived: true }), "archive with a draft on it")
      const moved = await ok(call("PUT", `/api/drafts/${String(draft.id)}`, { customer, series: "NEW", issueDate, dueDate }), "move draft")
      assert.equal(moved.series, "NEW")
      const back = await call("PUT", `/api/drafts/${String(draft.id)}`, { customer, series: "QWBE", issueDate, dueDate })
      assert.deepEqual([back.status, (back.body as { readonly code?: string }).code], [409, "document_series_archived"])
    } finally {
      await served.close()
    }
    const reader = await serve(fixture, allPlugins, { grants: (all) => all.filter((permission) => permission !== settingsManage) })
    try {
      const denied = await reader.call("PUT", archivePath("QWBE"), { archived: false })
      assert.deepEqual([denied.status, denied.body], [403, { error: "PermissionDenied" }])
    } finally {
      await reader.close()
    }
  })
})

void test("a Bearer call archives without a CSRF token and an anonymous one is refused", async () => {
  await withMigrated("series_archive_bearer", async (fixture) => {
    const token = "s".repeat(64)
    const tokenFile = join(fixture.dataDirectory, "api-token")
    writeFileSync(tokenFile, token, { mode: 0o600 })
    const runtime = {
      authenticate: createRequestAuthenticator(fixture.config({ authTokenFile: tokenFile })),
      pool: fixture.pool, dataDirectory: fixture.dataDirectory, plugins: allPlugins, transport: anafRegistry(),
    }
    const call = (authorization: string | undefined, url: string, method = "PUT", body: unknown = { archived: true }) =>
      handleApiRequest({ method, url, authorization, body }, runtime)
    const bearer = `Bearer ${token}`
    assert.equal((await call(bearer, "/api/document-series", "POST", { documentType: "invoice", series: "QWBE" })).status, 200)
    assert.equal((await call(undefined, archivePath("QWBE"))).status, 401)
    assert.deepEqual(await call(bearer, archivePath("QWBE")), { status: 200, body: invoiceSeries(true) })
  })
})
