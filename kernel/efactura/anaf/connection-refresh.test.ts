import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { refreshConnection } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { withMigrated, type TestFixture } from "../../storage/postgres-rig.test-support.ts"
import { ORG, accessToken, anafSettingsFor, connectionRig, type ConnectionRig } from "./connection.test-support.ts"
import { connectionHost } from "./connection-host.ts"

/** A rig with a live connection (`access-1`/`refresh-1`); refreshes run as the dispatcher will, outside any request. */
const withConnected = (label: string, use: (rig: ConnectionRig, refresh: () => Promise<string>, fixture: TestFixture) => Promise<void>) =>
  withMigrated(label, async (fixture) => {
    const rig = await connectionRig(fixture.pool, fixture.dataDirectory)
    try {
      assert.equal(await rig.callback(await rig.start(), "?code=initial"), "conectat")
      const refresh = () => Effect.runPromise(refreshConnection(rig.host)(ORG))
      await use(rig, refresh, fixture)
    } finally { await rig.dispose() }
  })

void test("a refresh stores the rotated pair under the same generation and a new revision", async () => {
  await withConnected("efref_ok", async (rig, refresh) => {
    const before = await rig.stored()
    assert.equal(await refresh(), "refreshed")
    const after = await rig.stored()
    assert.deepEqual([after?.status, after?.generation, after?.revision, accessToken(after)], ["connected", before?.generation, 1, "access-2"])
    assert.deepEqual(after?.identity, before?.identity, "who connected, the CIF and the refresh expiry stay")
    const sent = rig.fake.calls.filter(({ operation }) => operation === "token").at(-1)
    assert.deepEqual(Object.fromEntries(new URLSearchParams(sent?.body.toString("utf8"))),
      { grant_type: "refresh_token", refresh_token: "refresh-1", token_content_type: "jwt" })
  })
})

void test("two concurrent refreshes: one saves, the other's answer is thrown away", async () => {
  await withConnected("efref_twice", async (rig, refresh) => {
    const [first, second] = [rig.token.hold(), rig.token.hold()]
    const one = refresh()
    await first.reached
    const two = refresh()
    await second.reached
    first.release()
    assert.equal(await one, "refreshed")
    second.release()
    assert.equal(await two, "stale")
    const stored = await rig.stored()
    assert.deepEqual([stored?.revision, accessToken(stored)], [1, "access-2"])
  })
})

void test("a disconnect during a refresh wins: the refreshed pair is never written", async () => {
  await withConnected("efref_disconnect", async (rig, refresh) => {
    const held = rig.token.hold()
    const pending = refresh()
    await held.reached
    assert.equal((await rig.call("DELETE", "/efactura/connection")).status, 200)
    held.release()
    assert.equal(await pending, "stale")
    const stored = await rig.stored()
    assert.deepEqual([stored?.status, stored?.tokens], ["disconnected", undefined])
    assert.equal(await refresh(), "not_connected")
  })
})

void test("a refused refresh token asks for the certificate, audited, conditioned on what it observed", async () => {
  await withConnected("efref_refused", async (rig, refresh) => {
    rig.fake.answer("token", "error_in_200")
    assert.equal(await refresh(), "needs_reconnect")
    const stored = await rig.stored()
    assert.deepEqual([stored?.status, stored?.tokens, stored?.identity?.verifiedCif], ["needs_reconnect", undefined, "12345674"])
    assert.equal((await rig.call("GET", "/efactura/connection")).body.status, "needs_reconnect")
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected", "efactura_connection.needs_reconnect:refresh_refused"])
  })
})

void test("an old needs_reconnect does not invalidate the newer pair another refresh stored", async () => {
  await withConnected("efref_stale_fail", async (rig, refresh) => {
    const [refused, granted] = [rig.token.hold(), rig.token.hold()]
    const old = refresh()
    await refused.reached
    const fresh = refresh()
    await granted.reached
    granted.release()
    assert.equal(await fresh, "refreshed")
    rig.fake.answer("token", "error_in_200")
    refused.release()
    assert.equal(await old, "stale")
    const stored = await rig.stored()
    assert.deepEqual([stored?.status, accessToken(stored)], ["connected", "access-2"])
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected"])
  })
})

void test("no usable answer writes nothing; a pair that does not open is marked without asking ANAF", async () => {
  await withConnected("efref_unusable", async (rig, refresh, fixture) => {
    rig.fake.answer("token", "redirect")
    assert.equal(await refresh(), "unavailable")
    assert.deepEqual([(await rig.stored())?.revision, accessToken(await rig.stored())], [0, "access-1"])
    rig.fake.answer("token", "normal")
    const calls = rig.fake.calls.length
    const otherClient = connectionHost(fixture.pool, anafSettingsFor({ clientId: "another_client" }), rig.fake.transport)
    assert.equal(await Effect.runPromise(refreshConnection(otherClient)(ORG)), "needs_reconnect")
    assert.equal(rig.fake.calls.length, calls, "ANAF is not asked with a pair that does not open")
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected", "efactura_connection.needs_reconnect:token_unreadable"])
  })
})
