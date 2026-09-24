import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure, isTransientFailure, parseApiFailure } from "./api-errors.ts"

void test("preserves the established session error messages", () => {
  assert.equal(parseApiFailure({ error: "invalid_credentials" }, 401).message, "Tokenul API este incorect.")
  assert.equal(parseApiFailure({ error: "origin_not_allowed" }, 403).message, "Originea cererii de autentificare nu este permisă.")
  assert.equal(parseApiFailure({ error: "csrf_validation_failed" }, 403).message,
    "Sesiunea nu a putut valida cererea. Reîncarcă pagina și încearcă din nou.")
  assert.equal(parseApiFailure({ error: "upstream_unavailable" }, 502).message, "Serviciul API nu este disponibil momentan.")
  assert.equal(parseApiFailure({ error: "not_ready" }, 503).message, "Serviciul API nu este pregătit momentan.")
  assert.match(parseApiFailure({ error: "invalid_session_cookie" }, 400).message, /Șterge cookie-ul de sesiune/)
})

// The fiscal API answers a missing document with the bare tag; an unlocalized
// map leaks `ResourceNotFound` onto the screen, which is what it used to do.
void test("a missing document reads as a sentence, not as the backend tag", () => {
  const failure = parseApiFailure({ error: "ResourceNotFound" }, 404)
  assert.equal(failure.message, "Documentul cerut nu există sau nu mai este disponibil.")
  assert.equal(failure.status, 404)
  assert.equal(failure.message.includes("ResourceNotFound"), false)
  assert.equal(parseApiFailure({ error: "DocumentNotFound" }, 404).message,
    "Documentul cerut nu există sau nu mai este disponibil.")
})

void test("the document failures reachable from these screens are all localized", () => {
  for (const [tag, status] of [
    ["PermissionDenied", 403], ["DocumentsPermissionDenied", 403], ["ArtifactConflict", 409],
    ["DocumentRenderingFailure", 500], ["DocumentPersistenceFailure", 500], ["PersistenceFailure", 500],
    ["internal_failure", 500],
  ] as ReadonlyArray<readonly [string, number]>) {
    assert.equal(parseApiFailure({ error: tag }, status).message.includes(tag), false, tag)
  }
})

void test("a transport failure with no status still carries its own message", () => {
  assert.equal(parseApiFailure(undefined, 502).message, "Cererea a eșuat (502).")
})

void test("only a failure a repeat could answer differently is offered a retry", () => {
  assert.equal(isTransientFailure(new ApiFailure({ message: "offline" })), true)
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 429 })), true)
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 500 })), true)
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 503 })), true)
  assert.equal(isTransientFailure(parseApiFailure({ error: "ResourceNotFound" }, 404)), false)
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 403 })), false)
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 409 })), false)
  // A 401 is the session controller's business, not a button's.
  assert.equal(isTransientFailure(new ApiFailure({ message: "x", status: 401 })), false)
  assert.equal(isTransientFailure(new Error("decoder refused the payload")), false)
})
