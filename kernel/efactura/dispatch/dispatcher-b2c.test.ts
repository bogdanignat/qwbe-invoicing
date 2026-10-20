import assert from "node:assert/strict"
import test from "node:test"

import { gated } from "../anaf/connection.test-support.ts"
import { customer } from "../../http/plugins-http.test-support.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { SYNTHETIC_CNP, dispatchRig, privateBuyer, type DispatchRig } from "./dispatch.test-support.ts"

/**
 * B2C on the dispatcher, against a real database and the fake ANAF: a
 * document for a private person goes to `uploadb2c`, any other to `upload`,
 * and so does every later upload of it (a resubmit, a retry after a 401, a
 * restart). Nothing here reaches ANAF.
 */

const withRig = (label: string, use: (rig: DispatchRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await dispatchRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

const B2B = "/test/FCTEL/rest/upload?"
const B2C = "/test/FCTEL/rest/uploadb2c?"

/** Where each upload of the submission went: the path of every upload call whose body is its stored XML. */
const routes = async (rig: DispatchRig, id: string): Promise<ReadonlyArray<string>> => {
  const [stored] = await rig.sql("SELECT xml FROM efactura_submissions WHERE id=$1", [id])
  const xml = stored?.xml as Buffer
  return rig.fake.calls.filter((call) => call.operation === "upload" && call.body.equals(xml)).map((call) => call.path)
}

void test("the buyer picks the route: a private person with or without a CNP and their storno on uploadb2c, companies on upload",
  () => withRig("efb_routes", async (rig) => {
    await rig.connect()
    const anonymous = await rig.invoiceTo("inv-pf", privateBuyer())
    const identified = await rig.invoiceTo("inv-cnp", privateBuyer(SYNTHETIC_CNP))
    const vatPayer = await rig.invoiceTo("inv-vat", customer)
    const notVatPayer = await rig.invoiceTo("inv-novat", { ...customer, vatRegistered: false })
    // The storno is dated today: issued last, so no invoice of the series is dated before it.
    const storno = await rig.storno(anonymous, "storno-pf")
    const submissions = {
      anonymous: await rig.submitted(anonymous), identified: await rig.submitted(identified),
      storno: await rig.submitted(storno, "corrections"),
      vatPayer: await rig.submitted(vatPayer), notVatPayer: await rig.submitted(notVatPayer),
    }
    rig.dispatcher()
    for (const id of Object.values(submissions)) await rig.reaches(id, "processing")
    const paths: Record<string, ReadonlyArray<string>> = {}
    for (const [name, id] of Object.entries(submissions)) paths[name] = await routes(rig, id)
    assert.deepEqual(paths, {
      anonymous: [`${B2C}standard=UBL&cif=12345674`], identified: [`${B2C}standard=UBL&cif=12345674`],
      storno: [`${B2C}standard=CN&cif=12345674`],
      vatPayer: [`${B2B}standard=UBL&cif=12345674`], notVatPayer: [`${B2B}standard=UBL&cif=12345674`],
    })
    const uploaded = (needle: string) => rig.fake.calls.find((call) => call.path.startsWith(B2C) && call.body.toString("utf8").includes(needle))
    assert.equal(uploaded(SYNTHETIC_CNP)?.path, `${B2C}standard=UBL&cif=12345674`, "the CNP travels in the XML")
    assert.ok(uploaded("<cbc:CompanyID>0000000000000</cbc:CompanyID>") !== undefined, "13 zeros without one")

    rig.clock.offsetMs += 61_000
    for (const id of [submissions.anonymous, submissions.storno]) await rig.reaches(id, "accepted", "stored")
    assert.equal(rig.calls("upload"), 5, "polling and the download never upload again")
  }))

void test("a private buyer's resubmit, its retry after a 401 and its upload after a restart stay on uploadb2c",
  () => withRig("efb_again", async (rig) => {
    await rig.connect()
    const lost = await rig.submitted(await rig.invoiceTo("inv-1", privateBuyer()))
    await rig.sql("UPDATE efactura_submissions SET state='unknown' WHERE id=$1", [lost])
    const resubmitted = await rig.server.call("POST", `/api/efactura/submissions/${lost}/resubmit`, { confirmed: true })
    assert.equal(resubmitted.status, 202, JSON.stringify(resubmitted.body))
    const next = String((resubmitted.body as Record<string, unknown>).id)
    assert.deepEqual(await rig.sql("SELECT buyer_is_individual FROM efactura_submissions WHERE id=$1", [next]), [{ buyer_is_individual: true }])

    const token = gated(rig.fake.transport, "/token")
    const refresh = token.hold()
    rig.fake.answer("upload", "unauthorized")
    const first = rig.dispatcher(token.transport)
    await refresh.reached
    rig.fake.answer("upload", "normal")
    refresh.release()
    await rig.reaches(next, "processing")
    assert.deepEqual(await rig.attempts(next), ["validare:answered", "upload:auth_refused", "validare:answered", "upload:answered"])
    assert.deepEqual(await routes(rig, next), [`${B2C}standard=UBL&cif=12345674`, `${B2C}standard=UBL&cif=12345674`])
    await first.stop()

    const interrupted = await rig.submitted(await rig.invoiceTo("inv-2", privateBuyer(SYNTHETIC_CNP)))
    await rig.sql("UPDATE efactura_submissions SET state='validating' WHERE id=$1", [interrupted])
    rig.dispatcher()
    await rig.reaches(interrupted, "processing")
    assert.deepEqual(await routes(rig, interrupted), [`${B2C}standard=UBL&cif=12345674`], "validated again, then uploaded to uploadb2c")
    assert.ok(rig.fake.calls.filter((call) => call.operation === "upload").every((call) => call.path.startsWith(B2C)))
  }))
