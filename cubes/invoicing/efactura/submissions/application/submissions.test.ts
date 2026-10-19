import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../../contracts/failures.ts"
import { efacturaPermissions } from "../../connection/index.ts"
import { MAX_XML_BYTES, createSubmissionsService } from "./submissions.ts"
import type { ConnectionState, SubmissionsTransaction } from "./ports.ts"

/**
 * The submit guards that need no database: each refuses before anything is
 * stored, and a refusal before the XML never generates it.
 */

const permissions = efacturaPermissions("efactura")
const at = new Date("2026-10-19T10:00:00.000Z")
const connected: ConnectionState = { status: "connected", verifiedCif: "12345674", refreshExpiresAt: "2027-01-01T00:00:00.000Z" }

/** Reads find the connection and nothing current; any write is a defect that fails the test. */
const reads = (connection: ConnectionState): SubmissionsTransaction => {
  const write = () => Effect.die(new Error("a refused submit wrote"))
  return {
    findCurrent: () => Effect.succeed(undefined),
    findConnection: () => Effect.succeed(connection),
    insert: write, project: write, appendAuditEvent: write,
    history: () => Effect.succeed([]), resubmissions: () => Effect.succeed([]), readXml: () => Effect.succeed(undefined), readResponse: () => Effect.succeed(undefined),
  }
}

const refusal = async (configured: boolean, xmlBytes: number) => {
  let generated = 0
  const service = createSubmissionsService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [permissions.submit] },
      organization: { id: "org-1" } }) },
    permissions, clock: { now: Effect.succeed(at) }, ids: { next: Effect.succeed("id-1") },
    store: { transaction: (use) => use(reads(connected)) }, configured, environment: "test",
  })
  const failure = await Effect.runPromise(Effect.flip(service.submit({ kind: "invoice", id: "inv-1", issuerFiscalIdentifier: "RO12345674",
    buyerIsIndividual: false, xml: Effect.sync(() => { generated += 1; return new Uint8Array(xmlBytes) }) })))
  assert.ok(failure instanceof DomainConflict, String(failure))
  return { code: failure.code, generated }
}

void test("without an ANAF client nothing is submitted, and the XML is never generated", async () => {
  assert.deepEqual(await refusal(false, 100), { code: "efactura_not_configured", generated: 0 })
})

void test("an XML one byte over ANAF's 10 MB is refused before anything is stored", async () => {
  assert.deepEqual(await refusal(true, MAX_XML_BYTES + 1), { code: "efactura_xml_too_large", generated: 1 })
})
