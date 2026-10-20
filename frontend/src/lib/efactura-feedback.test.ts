import assert from "node:assert/strict"
import test from "node:test"

import { parseApiFailure } from "./api-errors.ts"
import { efacturaFailure, efacturaFailureMessage } from "./efactura-feedback.ts"

const conflict = (code: string) => parseApiFailure({ error: "DomainConflict", code }, 409)

void test("a 409 of the plugin reads as its own Romanian sentence, not as the bare tag", () => {
  for (const code of ["efactura_connection_refreshing", "efactura_rate_limited", "efactura_anaf_unavailable"]) {
    assert.match(efacturaFailureMessage(conflict(code)), /Reîncearcă peste un minut\.$/u, code)
  }
  assert.match(efacturaFailureMessage(conflict("efactura_not_connected")), /Conectează-te cu certificatul/u)
  assert.match(efacturaFailureMessage(conflict("efactura_b2c_refused")), /persoane fizice/u)
  assert.match(efacturaFailureMessage(conflict("efactura_index_not_listed")), /nu apare în lista ANAF/u)
  assert.doesNotMatch(efacturaFailureMessage(conflict("efactura_cif_mismatch")), /DomainConflict/u)
})

void test("a 403 names the missing right; anything else keeps the shared wording", () => {
  assert.match(efacturaFailureMessage(parseApiFailure({ error: "PermissionDenied" }, 403)), /^Nu ai permisiunea/u)
  assert.equal(efacturaFailureMessage(parseApiFailure({ error: "internal_failure" }, 500)), "Serviciul API a întâmpinat o eroare. Încearcă din nou.")
  assert.equal(efacturaFailureMessage(new Error("plain")), "plain")
  assert.equal(efacturaFailureMessage("string"), "A apărut o eroare neașteptată.")
})

void test("no failure is no alert", () => {
  assert.equal(efacturaFailure(null), undefined)
  assert.equal(efacturaFailure(undefined), undefined)
  assert.equal(efacturaFailure(conflict("efactura_index_linked"))?.message, "Indexul este deja legat de altă trimitere.")
})
