import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "./api-errors.ts"
import type { BrowserTransport, TransportOptions } from "./browser-transport.ts"
import { createSettingsClient, type IssuerInput } from "./settings-client.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

/**
 * The issuer `PUT` at the transport boundary: an answer that arrived but cannot
 * be read is `UnreadableAnswer` — the profile may be saved — while a refusal the
 * server did send stays the `ApiFailure` it is.
 */

const address = { countryCode: "RO", city: "Cluj-Napoca", street: "Str. Mică 1", county: "RO-CJ" }
const input: IssuerInput = {
  name: "Firma Test SRL", fiscalIdentifier: "12345674", address, legalForm: "srl",
  tradeRegistryNumber: "J12/1234/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca Test",
  socialCapital: "200.00", defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true, effectiveFrom: "2026-09-01" }, branding: null,
}
const saved = {
  organizationId: "org-1", name: input.name, fiscalIdentifier: input.fiscalIdentifier, address, legalForm: "srl",
  tradeRegistryNumber: input.tradeRegistryNumber, iban: input.iban, bankName: input.bankName,
  socialCapital: "200.00", defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatConfigurations: [], currentVat: null, branding: null,
}

const answering = (answer: () => unknown) => {
  const calls: Array<{ readonly path: string; readonly options: TransportOptions | undefined }> = []
  const transport: BrowserTransport = {
    json: (path, options) => { calls.push({ path, options }); return Promise.resolve().then(answer) },
    binary: () => { throw new Error("unscripted binary") },
  }
  return { calls, client: createSettingsClient(transport) }
}
const rejection = (answer: () => unknown) => answering(answer).client.saveIssuer("csrf", input).then(
  () => assert.fail("the save should have been refused"), (error: unknown) => error)

void test("a readable answer is the saved profile and its warnings, sent as a signed PUT", async () => {
  const { calls, client } = answering(() => ({ ...saved, warnings: ["vat_registry_not_checked"] }))
  const result = await client.saveIssuer("csrf", input)
  assert.equal(result.issuer.fiscalIdentifier, "12345674")
  assert.deepEqual(result.warnings, ["vat_registry_not_checked"])
  assert.deepEqual(calls, [{ path: "/api/issuer", options: { csrfToken: "csrf", method: "PUT", body: input } }])
})

void test("a 2xx without warnings, with an unknown one, or not JSON is unreadable, not a refusal", async () => {
  const notJson = () => { throw new ApiFailure({ message: "Cererea a eșuat (200).", status: 200 }) }
  for (const answer of [() => saved, () => ({ ...saved, warnings: ["something_new"] }), notJson]) {
    const error = await rejection(answer)
    assert.ok(error instanceof UnreadableAnswer, String(error))
    assert.match(error.message, /operația poate să fi fost înregistrată/u)
  }
})

void test("a refusal the server sent stays an ApiFailure with its Romanian message", async () => {
  const error = await rejection(() => {
    throw new ApiFailure({ message: "CIF-ul firmei nu mai poate fi schimbat.", status: 409, code: "fiscal_identifier_change_has_issued_documents" })
  })
  assert.ok(error instanceof ApiFailure && !(error instanceof UnreadableAnswer))
  assert.equal(error.status, 409)
})
