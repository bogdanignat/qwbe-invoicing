import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure, parseApiFailure } from "./api-errors.ts"
import { INTEGRATIONS_DENIED, companyLookupFailureMessage, integrationsLoad } from "./company-lookup-feedback.ts"
import { OPENAPI_NEEDS_KEY } from "./company-lookup-settings.ts"

const settings = { provider: "anaf", openapiKeyConfigured: false, openapiKeyLast4: null } as const
const snapshot = (data: unknown, error: unknown) => ({ data: data as typeof settings | undefined, isPending: data === undefined && error === null, error })

void test("the backend's refusals read in Romanian, from the answers the kernel sends", () => {
  assert.equal(companyLookupFailureMessage(parseApiFailure({ error: "PermissionDenied" }, 403)), INTEGRATIONS_DENIED)
  assert.match(companyLookupFailureMessage(parseApiFailure(
    { error: "DomainConflict", code: "company_lookup_key_storage_unavailable" }, 409)), /cheia de criptare/u)
  assert.match(companyLookupFailureMessage(parseApiFailure({ error: "ValidationFailure",
    issues: ["openapiKey must be 10 to 200 printable ASCII characters without spaces"] }, 400)), /10–200 de caractere/u)
  assert.equal(companyLookupFailureMessage(parseApiFailure({ error: "ValidationFailure",
    issues: ["provider openapi requires a configured openapiKey"] }, 400)), OPENAPI_NEEDS_KEY)
})

void test("an unknown 400 issue never reaches the screen in English", () => {
  const message = companyLookupFailureMessage(parseApiFailure({ error: "ValidationFailure", issues: ["provider must be one of none"] }, 400))
  assert.match(message, /nu sunt valide/u)
})

void test("other failures keep the message the transport already wrote", () => {
  assert.equal(companyLookupFailureMessage(new ApiFailure({ message: "Serviciul API nu a răspuns la timp.", status: 504 })),
    "Serviciul API nu a răspuns la timp.")
  assert.equal(companyLookupFailureMessage(new Error("Sesiunea nu mai poate semna cererea. Reîncarcă pagina.")),
    "Sesiunea nu mai poate semna cererea. Reîncarcă pagina.")
  assert.equal(companyLookupFailureMessage("boom"), "A apărut o eroare neașteptată.")
})

void test("the load: off without the plugin, a 403 is denied without a retry, data wins over a later failure", () => {
  assert.deepEqual(integrationsLoad(false, snapshot(settings, null)), { kind: "off" })
  assert.deepEqual(integrationsLoad(true, snapshot(undefined, null)), { kind: "loading" })
  assert.deepEqual(integrationsLoad(true, snapshot(undefined, new ApiFailure({ message: "x", status: 403 }))),
    { kind: "denied", message: INTEGRATIONS_DENIED })
  assert.deepEqual(integrationsLoad(true, snapshot(undefined, new ApiFailure({ message: "Indisponibil", status: 503 }))),
    { kind: "error", message: "Indisponibil", transient: true })
  assert.deepEqual(integrationsLoad(true, snapshot(settings, new ApiFailure({ message: "x", status: 503 }))),
    { kind: "ready", settings })
})
