import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { ORG } from "../efactura/anaf/connection.test-support.ts"
import { BROKEN_ZIP, FIXTURE_ZIP, RECEIVE, receivedRig, receivedZip, type ReceivedRig } from "../efactura/dispatch/received.test-support.ts"
import { serve, type Reply, type Served } from "../http/plugins-http.test-support.ts"
import { allPlugins } from "../plugins.ts"
import { createPostgresReceivedStore } from "../storage/postgres-efactura-received.ts"
import { withMigrated, type TestFixture } from "../storage/postgres-rig.test-support.ts"

/**
 * The received-invoice routes through the real server (session, CSRF, the
 * plugin's routes, a real database), the fake ANAF and the real dispatcher:
 * the click, the background fetch the page polls, and what it then reads.
 */

type Use = (rig: ReceivedRig, fixture: TestFixture) => Promise<void>
const withRig = (label: string, use: Use, grants?: Parameters<typeof receivedRig>[1]) => withMigrated(label, async (fixture) => {
  const rig = await receivedRig(fixture, grants)
  try { await use(rig, fixture) } finally { await rig.close() }
})

type Body = Record<string, unknown>
const bodyOf = (reply: Reply, status = 200): Body => {
  assert.equal(reply.status, status, JSON.stringify(reply.body))
  return reply.body as Body
}
const fetchOf = (status: Body) => status.fetch as Body
const itemsOf = (page: Body) => page.items as ReadonlyArray<Body>

/** The archive route answered as bytes, with the headers that matter for a download. */
const download = async (server: Served, id: string) => {
  const reply = await fetch(`${server.origin}/api/efactura/received/${id}/archive`, { headers: { cookie: server.cookie, origin: server.origin } })
  const header = (name: string) => reply.headers.get(name)
  return { status: reply.status, bytes: Buffer.from(await reply.arrayBuffer()),
    type: header("content-type"), disposition: header("content-disposition"), cache: header("cache-control") }
}

const requested = (rig: ReceivedRig) => rig.server.call("POST", "/api/efactura/received/fetches", {})
const status = async (rig: ReceivedRig): Promise<Body> => bodyOf(await rig.server.call("GET", "/api/efactura/received/status"))
const completed = async (rig: ReceivedRig): Promise<Body> => {
  await rig.until("the fetch completed, as the page polls it", async () => fetchOf(await status(rig)).state === "completed")
  return status(rig)
}

void test("a click is answered 202 at once; the dispatcher fetches; the list, detail, ZIP and status read what it stored", () =>
  withRig("efr_api", async (rig) => {
    await rig.connect()
    rig.fake.receive([{ id: "4000000001", zip: FIXTURE_ZIP, createdAt: "202610221000" }, { id: "4000000002", zip: BROKEN_ZIP, createdAt: "202610231100" }])
    assert.deepEqual(await status(rig), { fetch: null, coveredUntil: null }, "nothing fetched yet")
    const calls = rig.fake.calls.length
    const first = bodyOf(await requested(rig), 202)
    assert.deepEqual([first.state, first.cif, first.environment, "organizationId" in first], ["listing", "12345674", "test", false])
    assert.equal(rig.fake.calls.length, calls, "the request never calls ANAF")
    assert.equal(bodyOf(await requested(rig), 202).id, first.id, "asking again while it is active answers the same fetch")

    rig.dispatcher()
    const done = await completed(rig)
    const fetched = fetchOf(done)
    assert.deepEqual([fetched.id, fetched.found, fetched.downloaded, fetched.failed, fetched.errors], [first.id, 2, 2, 0, []])
    assert.equal(done.coveredUntil, (fetched.window as Body).end)

    const list = bodyOf(await rig.server.call("GET", "/api/efactura/received"))
    assert.equal(list.nextCursor, null)
    assert.deepEqual(itemsOf(list).map((item) => [item.messageId, item.readable]), [["4000000002", false], ["4000000001", true]], "newest first")
    const [unreadable, readable] = itemsOf(list)
    assert.equal((unreadable?.reason as Body).source, "zip")
    assert.deepEqual([readable?.spvCreatedAt, readable?.warnings], ["202610221000", 1])
    assert.deepEqual(readable?.listing, { kind: "invoice", number: "TEST 19", issueDate: (readable?.listing as Body).issueDate, currency: "RON",
      supplierName: "FURNIZOR TEST S.R.L.", supplierCif: "19999927", totalExcludingTax: "10.00", taxTotal: "0.00", payable: "10.00" })

    const detail = bodyOf(await rig.server.call("GET", "/api/efactura/received/4000000001"))
    assert.deepEqual([detail.readable, (detail.content as Body).number, detail.warnings],
      [true, "TEST 19", [{ code: "buyer_cif_mismatch", expected: "12345674", found: ["19999927"] }]])
    assert.ok(Array.isArray((detail.content as Body).lines), "the whole document, lines and all")
    const unread = bodyOf(await rig.server.call("GET", "/api/efactura/received/4000000002"))
    assert.deepEqual([unread.readable, unread.reason, "content" in unread], [false, unreadable?.reason, false])

    const zip = await download(rig.server, "4000000001")
    assert.deepEqual([zip.status, zip.type, zip.disposition, zip.cache],
      [200, "application/zip", "attachment; filename=\"efactura-primita-4000000001.zip\"", "no-store"])
    assert.deepEqual(zip.bytes, FIXTURE_ZIP, "ANAF's ZIP byte for byte")
    assert.deepEqual((await download(rig.server, "4000000002")).bytes, BROKEN_ZIP, "an unreadable one downloads all the same")
    assert.equal((await rig.server.call("GET", "/api/efactura/received/4000000003")).status, 404)
  }))

void test("the list pages newest first, then by the id as a number, with an opaque cursor, and refuses one it did not give", () =>
  withRig("efr_api_pages", async (rig) => {
    await rig.connect()
    const same = "202610201000"
    rig.fake.receive([{ id: "9", createdAt: same }, { id: "4000000001", createdAt: same }, { id: "5", createdAt: "202610211000" },
      { id: "10", createdAt: same }].map(({ id, createdAt }) => ({ id, createdAt, zip: receivedZip(`R-${id}`) })))
    bodyOf(await requested(rig), 202)
    rig.dispatcher()
    await completed(rig)
    const first = bodyOf(await rig.server.call("GET", "/api/efactura/received?limit=2"))
    assert.deepEqual(itemsOf(first).map((item) => item.messageId), ["5", "4000000001"])
    const second = bodyOf(await rig.server.call("GET", `/api/efactura/received?limit=2&cursor=${String(first.nextCursor)}`))
    assert.deepEqual([itemsOf(second).map((item) => item.messageId), second.nextCursor], [["10", "9"], null], "9 < 10, not as text")
    assert.equal((await rig.server.call("GET", "/api/efactura/received?cursor=nonsense")).status, 400)
  }))

void test("a fetch is refused with 409 without a connection or for another CIF, and nothing is recorded", () =>
  withRig("efr_api_refused", async (rig) => {
    assert.deepEqual(bodyOf(await requested(rig), 409), { error: "DomainConflict", code: "efactura_not_connected" })
    await rig.connect({ cif: "18547290" })
    assert.deepEqual(bodyOf(await requested(rig), 409), { error: "DomainConflict", code: "efactura_cif_mismatch" })
    assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_received_fetches"))[0]?.n, 0)
  }))

void test("without efactura:receive a fetch is refused with 403, but efactura:read still reads", () => withRig("efr_api_forbidden", async (rig) => {
  await rig.connect()
  assert.deepEqual(bodyOf(await requested(rig), 403), { error: "PermissionDenied" })
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_received_fetches"))[0]?.n, 0)
  assert.deepEqual(await status(rig), { fetch: null, coveredUntil: null })
  assert.deepEqual(bodyOf(await rig.server.call("GET", "/api/efactura/received")), { items: [], nextCursor: null })
}, (permissions) => permissions.filter((permission) => permission !== RECEIVE)))

void test("another organization or environment reads nothing of it: empty list and status, 404 on detail and ZIP; without efactura:read, 403", () =>
  withRig("efr_api_isolated", async (rig, fixture) => {
    await rig.connect()
    rig.fake.receive([{ id: "4000000001", zip: FIXTURE_ZIP }])
    bodyOf(await requested(rig), 202)
    rig.dispatcher()
    await completed(rig)
    const other = await serve(fixture, allPlugins, { settings: rig.settings, organizationId: "org-2" })
    const unread = await serve(fixture, allPlugins, { settings: rig.settings, grants: (all) => all.filter((p) => p !== "efactura:read") })
    try {
      assert.deepEqual(bodyOf(await other.call("GET", "/api/efactura/received")), { items: [], nextCursor: null })
      assert.deepEqual(bodyOf(await other.call("GET", "/api/efactura/received/status")), { fetch: null, coveredUntil: null })
      assert.deepEqual([(await other.call("GET", "/api/efactura/received/4000000001")).status, (await download(other, "4000000001")).status], [404, 404])
      for (const path of ["/api/efactura/received", "/api/efactura/received/status", "/api/efactura/received/4000000001"]) {
        assert.deepEqual(bodyOf(await unread.call("GET", path), 403), { error: "PermissionDenied" }, path)
      }
      assert.equal((await download(unread, "4000000001")).status, 403)
      const prod = { organizationId: ORG, environment: "prod" } as const
      assert.deepEqual(await Effect.runPromise(createPostgresReceivedStore(fixture.pool, "prod").transaction((t) => Effect.all([
        t.latestFetch(prod), t.listReceived(prod, { limit: 10 }), t.findReceived(prod, "4000000001"), t.readArchive(prod, "4000000001")]))),
      [undefined, [], undefined, undefined], "the other environment reads nothing either")
    } finally {
      await Promise.all([other.close(), unread.close()])
    }
  }))
