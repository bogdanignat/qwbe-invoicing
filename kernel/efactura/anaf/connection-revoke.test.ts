import assert from "node:assert/strict"
import test from "node:test"

import { withMigrated, type TestFixture } from "../../storage/postgres-rig.test-support.ts"
import { accessToken, connectionRig, type ConnectionRig } from "./connection.test-support.ts"

const withRig = (label: string, use: (rig: ConnectionRig, fixture: TestFixture) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await connectionRig(fixture.pool, fixture.dataDirectory)
  try { await use(rig, fixture) } finally { await rig.dispose() }
})

void test("a granted pair the callback does not keep is revoked, and a failed revoke changes no outcome", async () => {
  await withRig("efrevoke_unkept", async (rig) => {
    rig.fake.answer("lista", "error_in_200")
    assert.equal(await rig.callback(await rig.start(), "?code=a"), "fara_drept_cif")
    rig.fake.answer("lista", "redirect")
    assert.equal(await rig.callback(await rig.start(), "?code=b"), "verificare_esuata")
    assert.deepEqual(rig.revoked(), ["refresh-1", "refresh-2"])

    rig.fake.answer("revoke", "error_in_200")
    rig.fake.answer("lista", "error_in_200")
    assert.equal(await rig.callback(await rig.start(), "?code=c"), "fara_drept_cif", "ANAF refusing the revoke")
    rig.fake.answer("revoke", "redirect")
    assert.equal(await rig.callback(await rig.start(), "?code=d"), "fara_drept_cif", "no usable revoke answer")
    assert.deepEqual(rig.revoked(), ["refresh-1", "refresh-2", "refresh-3", "refresh-4"])
    assert.equal((await rig.stored())?.status, "disconnected")
    assert.deepEqual(await rig.audit(), [])
  })
})

void test("a reconnect keeps the new pair and revokes the old one after the commit, even when ANAF refuses the revoke", async () => {
  await withRig("efrevoke_reconnect", async (rig, fixture) => {
    assert.equal(await rig.callback(await rig.start(), "?code=a"), "conectat")
    assert.deepEqual(rig.revoked(), [], "nothing to revoke on a first connection")
    assert.equal(await rig.callback(await rig.start(), "?code=b"), "conectat")
    assert.equal(accessToken(await rig.stored()), "access-2")
    assert.deepEqual(rig.revoked(), ["refresh-1"])

    rig.fake.answer("revoke", "error_in_200")
    assert.equal(await rig.callback(await rig.start(), "?code=c"), "conectat")
    assert.equal(accessToken(await rig.stored()), "access-3")
    assert.deepEqual(rig.revoked(), ["refresh-1", "refresh-2"])

    await fixture.pool.query("UPDATE efactura_connections SET access_token_ciphertext = refresh_token_ciphertext")
    assert.equal(await rig.callback(await rig.start(), "?code=d"), "conectat")
    assert.equal(accessToken(await rig.stored()), "access-4")
    assert.deepEqual(rig.revoked(), ["refresh-1", "refresh-2"], "a pair that no longer opens has nothing to send")
    assert.deepEqual(await rig.audit(), Array<string>(4).fill("efactura_connection.connected"))
  })
})
