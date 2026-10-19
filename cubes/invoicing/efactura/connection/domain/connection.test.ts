import assert from "node:assert/strict"
import test from "node:test"

import { accessRefreshDue, attemptVerdict, connectionStatus, refreshExpiryWarning, tokenAssociatedData } from "./connection.ts"
import { foreignEnvironments, isAnafEnvironment } from "./environment.ts"

const at = new Date("2026-10-19T12:00:00.000Z")
const inDays = (days: number) => new Date(at.getTime() + days * 86_400_000).toISOString()

void test("only test and prod are environments, spelled exactly", () => {
  assert.equal(isAnafEnvironment("test"), true)
  assert.equal(isAnafEnvironment("prod"), true)
  for (const value of ["", "TEST", "production", " prod", undefined, null, 1]) assert.equal(isAnafEnvironment(value), false, String(value))
})

void test("the environment guard names every other environment existing submissions were made in", () => {
  assert.deepEqual(foreignEnvironments("test", []), [])
  assert.deepEqual(foreignEnvironments("test", ["test", "test"]), [])
  assert.deepEqual(foreignEnvironments("test", ["test", "prod", "prod"]), ["prod"])
  assert.deepEqual(foreignEnvironments("prod", ["test"]), ["test"])
})

void test("the status: the configuration first, then the row, and a lapsed refresh token asks for the certificate", () => {
  assert.equal(connectionStatus(false, { status: "connected", refreshExpiresAt: inDays(100) }, at), "not_configured")
  assert.equal(connectionStatus(true, undefined, at), "disconnected")
  assert.equal(connectionStatus(true, { status: "disconnected" }, at), "disconnected")
  assert.equal(connectionStatus(true, { status: "connected", refreshExpiresAt: inDays(100) }, at), "connected")
  assert.equal(connectionStatus(true, { status: "connected", refreshExpiresAt: inDays(0) }, at), "needs_reconnect")
  assert.equal(connectionStatus(true, { status: "connected", refreshExpiresAt: inDays(-1) }, at), "needs_reconnect")
  assert.equal(connectionStatus(true, { status: "needs_reconnect", refreshExpiresAt: inDays(100) }, at), "needs_reconnect")
})

void test("the access token is refreshed inside seven days; the refresh token is warned about inside thirty", () => {
  assert.equal(accessRefreshDue(inDays(8), at), false)
  assert.equal(accessRefreshDue(inDays(7), at), false)
  assert.equal(accessRefreshDue(inDays(6.99), at), true)
  assert.equal(accessRefreshDue(inDays(-1), at), true)
  assert.equal(refreshExpiryWarning(inDays(31), at), false)
  assert.equal(refreshExpiryWarning(inDays(29), at), true)
})

void test("an attempt is usable once and only before it expires", () => {
  assert.equal(attemptVerdict(undefined, at), "missing")
  assert.equal(attemptVerdict({ consumed: false, expiresAt: inDays(0.001) }, at), "usable")
  assert.equal(attemptVerdict({ consumed: false, expiresAt: inDays(0) }, at), "expired")
  assert.equal(attemptVerdict({ consumed: true, expiresAt: inDays(1) }, at), "consumed")
})

void test("each token is sealed under its kind, organization, environment, client and generation", () => {
  const binding = { kind: "access", organizationId: "org-1", environment: "test", clientId: "abc123", generation: 4 } as const
  assert.equal(tokenAssociatedData(binding), "efactura:access:org-1:test:abc123:4")
  const variants = [{ kind: "refresh" }, { organizationId: "org-2" }, { environment: "prod" }, { clientId: "abc124" }, { generation: 5 }] as const
  for (const change of variants) assert.notEqual(tokenAssociatedData({ ...binding, ...change }), tokenAssociatedData(binding), JSON.stringify(change))
})
