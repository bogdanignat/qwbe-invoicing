import assert from "node:assert/strict"
import test from "node:test"

import { parseApiFailure } from "./api-errors.ts"

void test("preserves the established session error messages", () => {
  assert.equal(parseApiFailure({ error: "invalid_credentials" }, 401).message, "Tokenul API este incorect.")
  assert.equal(parseApiFailure({ error: "origin_not_allowed" }, 403).message, "Originea cererii de autentificare nu este permisă.")
  assert.equal(parseApiFailure({ error: "csrf_validation_failed" }, 403).message,
    "Sesiunea nu a putut valida cererea. Reîncarcă pagina și încearcă din nou.")
  assert.equal(parseApiFailure({ error: "upstream_unavailable" }, 502).message, "Serviciul API nu este disponibil momentan.")
  assert.equal(parseApiFailure({ error: "not_ready" }, 503).message, "Serviciul API nu este pregătit momentan.")
  assert.match(parseApiFailure({ error: "invalid_session_cookie" }, 400).message, /Șterge cookie-ul de sesiune/)
})
