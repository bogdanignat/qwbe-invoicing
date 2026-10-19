import assert from "node:assert/strict"
import test from "node:test"

import { ATTEMPT_NOTE, connectionView, decodeAuthorizeUrl, decodeEFacturaConnection } from "./efactura-connection.ts"

const connected = {
  status: "connected", environment: "test", verifiedCif: "RO19999919", refreshExpiresAt: "2027-10-19T10:00:00.000Z",
  refreshExpiryWarning: false, connectedBy: "api-token", connectedAt: "2026-10-19T10:00:00.000Z", attempt: "none",
}
const bare = { ...connected, status: "disconnected", verifiedCif: null, refreshExpiresAt: null, connectedBy: null, connectedAt: null }

void test("the connection decodes as sent and refuses what the screen cannot branch on", () => {
  assert.deepEqual(decodeEFacturaConnection(connected), connected)
  assert.throws(() => decodeEFacturaConnection({ ...connected, status: "pending" }), /invalid status/u)
  assert.throws(() => decodeEFacturaConnection({ ...connected, environment: "staging" }), /invalid environment/u)
  assert.throws(() => decodeEFacturaConnection({ ...connected, attempt: "unknown" }), /invalid attempt/u)
  assert.throws(() => decodeEFacturaConnection({ ...connected, refreshExpiryWarning: "no" }), /invalid refreshExpiryWarning/u)
  assert.throws(() => decodeEFacturaConnection([]), /expected object/u)
})

void test("a connected answer without the CIF, the moment or the expiry ANAF proved is refused", () => {
  for (const field of ["verifiedCif", "connectedAt", "refreshExpiresAt"]) {
    assert.throws(() => decodeEFacturaConnection({ ...connected, [field]: null }), /invalid connected identity/u, field)
  }
  assert.equal(decodeEFacturaConnection(bare).status, "disconnected")
})

void test("the authorize URL is followed only to ANAF's OAuth server, not to another ANAF subdomain", () => {
  const url = "https://logincert.anaf.ro/anaf-oauth2/v1/authorize?response_type=code&client_id=x"
  assert.equal(decodeAuthorizeUrl({ authorizeUrl: url }), url)
  const refused = [
    "http://logincert.anaf.ro/anaf-oauth2/v1/authorize", "https://webserviced.anaf.ro/anaf-oauth2/v1/authorize",
    "https://logincert.anaf.ro/alt/authorize", "https://logincert.anaf.ro:8443/anaf-oauth2/v1/authorize",
    "https://evil.example/x", "https://logincert.anaf.ro.evil.example/anaf-oauth2/", "javascript:alert(1)", 42,
  ]
  for (const bad of refused) {
    assert.throws(() => decodeAuthorizeUrl({ authorizeUrl: bad }), String(bad))
  }
})

void test("the environment is a label, TEST or PRODUCȚIE", () => {
  assert.equal(connectionView(decodeEFacturaConnection(connected)).environment, "TEST")
  assert.equal(connectionView(decodeEFacturaConnection({ ...connected, environment: "prod" })).environment, "PRODUCȚIE")
})

void test("not configured: no action, and the way to the documentation", () => {
  const view = connectionView(decodeEFacturaConnection({ ...bare, status: "not_configured", attempt: "pending" }))
  assert.equal(view.statusLabel, "Neconfigurat")
  assert.equal(view.connectLabel, undefined)
  assert.equal(view.canDisconnect, false)
  assert.match(view.explanation, /docs\/LOCAL_DEVELOPMENT\.md/u)
  assert.equal(view.attemptNote, undefined)
})

void test("disconnected offers the certificate; connected shows the CIF, who and when, and offers both actions", () => {
  const off = connectionView(decodeEFacturaConnection(bare))
  assert.deepEqual([off.statusLabel, off.connectLabel, off.canDisconnect, off.facts], ["Deconectat", "Conectează cu certificatul", false, []])
  const on = connectionView(decodeEFacturaConnection(connected))
  assert.deepEqual([on.statusLabel, on.tone, on.connectLabel, on.canDisconnect], ["Conectat", "positive", "Reconectează cu certificatul", true])
  assert.deepEqual(on.facts.map((fact) => fact.label), ["CIF verificat", "Conectat la", "Conexiunea expiră"])
  assert.equal(on.facts[0]?.value, "RO19999919")
  assert.match(on.facts[1]?.value ?? "", /^19\.10\.2026, 13:00 de api-token$/u)
  assert.equal(on.expiryWarning, undefined)
})

void test("the expiry warning shows only on a connected answer that carries it", () => {
  const warned = connectionView(decodeEFacturaConnection({ ...connected, refreshExpiryWarning: true }))
  assert.match(warned.expiryWarning ?? "", /^Conexiunea cu ANAF expiră pe 19\.10\.2027/u)
  const lapsed = connectionView(decodeEFacturaConnection({ ...connected, status: "needs_reconnect", refreshExpiryWarning: true }))
  assert.equal(lapsed.expiryWarning, undefined)
  assert.deepEqual([lapsed.statusLabel, lapsed.tone, lapsed.canDisconnect], ["Necesită reconectare", "danger", true])
})

void test("an attempt that never came back from ANAF says to retry in a few minutes", () => {
  for (const attempt of ["pending", "expired"]) {
    assert.equal(connectionView(decodeEFacturaConnection({ ...bare, attempt })).attemptNote, ATTEMPT_NOTE)
  }
  assert.equal(ATTEMPT_NOTE, "Dacă ANAF a afișat o pagină de eroare sau n-ai fost întors aici, reîncearcă peste câteva minute.")
  assert.equal(connectionView(decodeEFacturaConnection(bare)).attemptNote, undefined)
})
