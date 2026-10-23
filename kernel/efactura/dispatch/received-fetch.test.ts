import assert from "node:assert/strict"
import test from "node:test"

import { OVERLAP_MS } from "../../../cubes/invoicing/efactura/received/index.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { BROKEN_ZIP, FIXTURE_ZIP, receivedRig, receivedZip, type ReceivedRig } from "./received.test-support.ts"

/**
 * A fetch of received invoices from the click to the stored archives, against
 * a real database, the fake ANAF and the real dispatcher.
 */
const withRig = (label: string, use: (rig: ReceivedRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await receivedRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

void test("a fetch lists two pages with filtru=P, downloads every received invoice and stores its archive and reading", () =>
  withRig("efr_fetch", async (rig) => {
    await rig.connect()
    await rig.invoice("sent-1")
    rig.fake.receive([{ id: "4000000001", zip: FIXTURE_ZIP }, { id: "4000000002", zip: receivedZip("R-2") }, { id: "4000000003", zip: receivedZip("R-3") }])
    rig.fake.paginate(2)
    const { fetch, created } = await rig.request()
    assert.deepEqual([created, fetch.state, fetch.cif, fetch.window.gap], [true, "listing", "12345674", undefined])
    rig.dispatcher()
    const done = await rig.ends(fetch)
    assert.deepEqual([done.pages_listed, done.pages_total, done.found, done.queued, done.downloaded, done.failed], [2, 2, 3, 3, 3, 0])
    assert.deepEqual(rig.listCalls().map(({ path }) => new URL(path, "https://x").searchParams.get("filtru")), ["P", "P"])
    assert.deepEqual(rig.listCalls().map(({ path }) => new URL(path, "https://x").searchParams.get("pagina")), ["1", "2"])
    assert.deepEqual((await rig.messages()).map(({ state }) => state), ["stored", "stored", "stored"])
    const archives = await rig.archives()
    assert.deepEqual(Buffer.from(archives[0]?.archive as Uint8Array), FIXTURE_ZIP, "the archive is ANAF's ZIP byte for byte")
    const invoices = await rig.invoices()
    assert.deepEqual(invoices.map(({ number, content_number }) => [number, content_number]), [["TEST 19", "TEST 19"], ["R-2", "R-2"], ["R-3", "R-3"]])
    assert.deepEqual(invoices[0], {
      anaf_message_id: "4000000001", document_kind: "invoice", number: "TEST 19", supplier_name: "FURNIZOR TEST S.R.L.", supplier_cif: "19999927",
      total_excluding_tax: "1000", tax_total: "0", payable: "1000", content_number: "TEST 19", due: "string",
      warnings: [{ code: "buyer_cif_mismatch", expected: "12345674", found: ["19999927"] }],
    })
    assert.equal(await rig.coveredUntil(), done.window_end, "the window its first page was listed for")
    assert.equal(rig.calls("descarcare"), 3, "the issued invoice's FACTURA TRIMISA was never listed under filtru=P")
  }))

void test("a second fetch starts one day before the coverage, takes only the new invoice and duplicates nothing", () =>
  withRig("efr_again", async (rig) => {
    await rig.connect()
    rig.fake.receive([{ id: "4000000001", zip: receivedZip("R-1") }, { id: "4000000002", zip: receivedZip("R-2") }])
    rig.dispatcher()
    const first = (await rig.request()).fetch
    const firstDone = await rig.ends(first)
    rig.fake.receive([{ id: "4000000003", zip: receivedZip("R-3") }])
    rig.clock.offsetMs += 60_000
    const second = (await rig.request()).fetch
    assert.equal(second.window.start, new Date(Date.parse(String(firstDone.window_end)) - OVERLAP_MS).toISOString())
    const done = await rig.ends(second)
    assert.deepEqual([done.found, done.queued, done.downloaded], [3, 1, 1])
    assert.equal((await rig.archives()).length, 3)
    assert.deepEqual((await rig.messages()).map(({ fetch_id }) => fetch_id), [first.id, first.id, second.id])
    assert.equal(rig.calls("descarcare"), 3)
    assert.equal(await rig.coveredUntil(), done.window_end)
  }))

void test("asking again while a fetch is active answers that fetch; two clicks at once make one", () => withRig("efr_active", async (rig) => {
  await rig.connect()
  const [one, two] = await Promise.all([rig.request(), rig.request()])
  assert.equal(one.fetch.id, two.fetch.id)
  assert.deepEqual([one.created, two.created].sort(), [false, true])
  const again = await rig.request()
  assert.deepEqual([again.created, again.fetch.id], [false, one.fetch.id])
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_received_fetches"))[0]?.n, 1)
}))

void test("a ZIP that cannot be opened is kept as ANAF sent it, and read as unreadable with the reason", () => withRig("efr_broken", async (rig) => {
  await rig.connect()
  rig.fake.receive([{ id: "4000000001", zip: BROKEN_ZIP }])
  rig.dispatcher()
  const done = await rig.ends((await rig.request()).fetch)
  assert.deepEqual([done.downloaded, done.failed], [1, 0])
  assert.deepEqual(Buffer.from((await rig.archives())[0]?.archive as Uint8Array), BROKEN_ZIP)
  assert.deepEqual(await rig.invoices(), [])
  const [unreadable] = await rig.sql("SELECT reason FROM efactura_received_unreadable WHERE anaf_message_id='4000000001'")
  assert.equal((unreadable?.reason as { source: string }).source, "zip")
  assert.ok(await rig.coveredUntil(), "a stored archive counts as downloaded")
}))

void test("a dispatcher stopped mid-fetch leaves it where its last write was; the next one goes on from there", () =>
  withRig("efr_crash", async (rig) => {
    await rig.connect()
    rig.fake.receive(["1", "2", "3", "4"].map((n) => ({ id: `400000000${n}`, zip: receivedZip(`R-${n}`) })))
    rig.fake.paginate(1)
    rig.fake.delay("descarcare", 300)
    const { fetch } = await rig.request()
    const first = rig.dispatcher()
    await rig.until("one invoice stored", async () => Number((await rig.fetchRow(fetch.id)).downloaded) >= 1)
    await first.stop()
    const halfway = await rig.fetchRow(fetch.id)
    assert.equal(halfway.state, "downloading")
    assert.ok(Number(halfway.downloaded) < 4)
    rig.dispatcher()
    const done = await rig.ends(fetch)
    assert.deepEqual([done.pages_listed, done.found, done.queued, done.downloaded], [4, 4, 4, 4])
    assert.equal(rig.listCalls().length, 4, "no page was listed twice")
    assert.deepEqual((await rig.invoices()).map(({ number }) => number), ["R-1", "R-2", "R-3", "R-4"])
  }))
