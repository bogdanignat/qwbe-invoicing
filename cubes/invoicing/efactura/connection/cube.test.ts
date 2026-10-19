import assert from "node:assert/strict"
import test from "node:test"

import { connectionMigrations, cube } from "./index.ts"

void test("declares the connection as a required child of e-Factura, owning its two tables", () => {
  assert.equal(cube.manifest.name, "connection")
  assert.equal(cube.manifest.parent, "efactura")
  assert.equal(cube.manifest.required, true)
  assert.deepEqual(cube.manifest.tables, ["efactura_connections", "efactura_oauth_attempts"])
})

void test("one baseline creates exactly the declared tables, and never a nullable column the state does not explain", () => {
  assert.deepEqual(connectionMigrations.map(({ name }) => name), ["efactura-connection-001-baseline"])
  const statements = connectionMigrations.flatMap(({ statements }) => statements)
  const created = statements.map((statement) => /^CREATE TABLE (\w+)\(/u.exec(statement)?.[1]).filter((name) => name !== undefined)
  assert.deepEqual(created, cube.manifest.tables)
  const [connections] = statements
  assert.ok(connections !== undefined)
  // The token pair and the identity are nullable only because a disconnected row has none; a CHECK binds each to the status.
  for (const nullable of ["access_token_ciphertext TEXT,", "refresh_token_ciphertext TEXT,", "verified_cif TEXT ", "connected_at TEXT,"]) {
    assert.ok(connections.includes(nullable), nullable)
  }
  assert.match(connections, /efactura_connections_tokens_only_connected CHECK\(\(status='connected'\)=/u)
  assert.match(connections, /efactura_connections_identity_unless_disconnected CHECK\(\(status='disconnected'\)=/u)
})
