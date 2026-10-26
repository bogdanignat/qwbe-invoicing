import assert from "node:assert/strict"
import test from "node:test"

import { withMigrated, type TestFixture } from "../../storage/postgres-rig.test-support.ts"
import { CLIENT_SECRET, ISSUER_CIF, accessToken, connectionRig, type ConnectionRig } from "./connection.test-support.ts"

const CODE = "?code=AUTH-CODE-DO-NOT-LEAK-91c2"

const withRig = (label: string, use: (rig: ConnectionRig, fixture: TestFixture) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await connectionRig(fixture.pool, fixture.dataDirectory)
  try { await use(rig, fixture) } finally { await rig.dispose() }
})

const status = async (rig: ConnectionRig) => (await rig.call("GET", "/efactura/connection")).body

void test("a recognised positive answer connects: tokens sealed, the CIF and who connected shown, audited, nothing leaked", async () => {
  await withRig("efconn_ok", async (rig, fixture) => {
    const cookie = await rig.start()
    assert.equal((await status(rig)).attempt, "pending")
    assert.equal(await rig.callback(cookie, CODE), "conectat")
    const view = await status(rig)
    assert.deepEqual({ ...view, refreshExpiresAt: undefined }, { status: "connected", environment: "test", verifiedCif: ISSUER_CIF,
      refreshExpiresAt: undefined, refreshExpiryWarning: false, connectedBy: "user-1", connectedAt: "2026-10-19T12:00:00.000Z", attempt: "none" })
    assert.equal(view.refreshExpiresAt, "2027-10-19T12:00:00.000Z")
    assert.equal(accessToken(await rig.stored()), "access-1")
    const row = (await rig.call("GET", "/efactura/connection")).body
    assert.equal(JSON.stringify(row).includes("access-"), false, "the view never carries a token")
    const exchange = rig.fake.calls.find(({ operation }) => operation === "token")
    assert.ok(exchange !== undefined)
    assert.equal(exchange.authorization, `Basic ${Buffer.from(`qwbe_test_client:${CLIENT_SECRET}`).toString("base64")}`)
    assert.deepEqual(Object.fromEntries(new URLSearchParams(exchange.body.toString("utf8"))), { grant_type: "authorization_code",
      code: "AUTH-CODE-DO-NOT-LEAK-91c2", redirect_uri: "https://invoice.test/api/anaf/callback", token_content_type: "jwt" })
    const list = rig.fake.calls.find(({ operation }) => operation === "lista")
    assert.match(list?.path ?? "", new RegExp(`^/test/FCTEL/rest/listaMesajePaginatieFactura\\?startTime=\\d+&endTime=\\d+&cif=${ISSUER_CIF}&pagina=1$`, "u"))
    assert.equal(list?.authorization, "Bearer access-1")
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected"])
    const { rows } = await fixture.pool.query("SELECT access_token_ciphertext, refresh_token_ciphertext FROM efactura_connections")
    assert.equal(JSON.stringify(rows).includes("access-1") || JSON.stringify(rows).includes("refresh-1"), false, "only ciphertext at rest")
    const attempts = await fixture.pool.query("SELECT * FROM efactura_oauth_attempts")
    assert.equal(JSON.stringify(attempts.rows).includes(cookie.split("=")[1] ?? "?"), false, "only the nonce's hash at rest")
  })
})

void test("every refused callback is a 303 with its fixed code and writes no connection", async () => {
  await withRig("efconn_refused", async (rig) => {
    assert.equal(await rig.callback(undefined, CODE), "tentativa_lipsa", "no cookie")
    assert.equal(await rig.callback("qwbe_anaf_oauth=not-a-nonce", CODE), "tentativa_lipsa", "a malformed cookie")
    const replaced = await rig.start()
    await rig.start()
    assert.equal(await rig.callback(replaced, CODE), "tentativa_lipsa", "an attempt that is no longer current")
    const expired = await rig.start()
    rig.clock.now += 600_000
    assert.equal((await status(rig)).attempt, "expired")
    assert.equal(await rig.callback(expired, CODE), "tentativa_expirata")
    const refused = await rig.start()
    assert.equal(await rig.callback(refused, "?error=access_denied&error_description=x"), "refuzat_anaf")
    assert.equal(await rig.callback(refused, ""), "cod_lipsa")
    assert.equal(await rig.callback(refused, "?code=a&code=b"), "cod_lipsa", "a repeated code is not guessed at")
    assert.equal((await status(rig)).attempt, "pending", "an error or a missing code does not consume the attempt")
    assert.equal(await rig.callback(refused, "?code=expired"), "schimb_esuat", "invalid_grant")
    assert.equal(await rig.callback(refused, CODE), "tentativa_folosita", "a callback with a code consumes it")
    rig.fake.answer("token", "redirect")
    assert.equal(await rig.callback(await rig.start(), CODE), "schimb_esuat", "no usable answer")
    rig.fake.answer("token", "normal")
    rig.fake.answer("lista", "error_in_200")
    assert.equal(await rig.callback(await rig.start(), CODE), "fara_drept_cif")
    for (const scenario of ["redirect", "dtd", "rate_limited", "oversized"] as const) {
      rig.fake.answer("lista", scenario)
      assert.equal(await rig.callback(await rig.start(), CODE), "verificare_esuata", scenario)
    }
    assert.equal((await status(rig)).status, "disconnected")
    assert.equal(accessToken(await rig.stored()), undefined)
    assert.deepEqual(await rig.audit(), [])
  })
})

void test("an error or code-less callback leaves the attempt cookie; one with a code clears it", async () => {
  await withRig("efconn_cookie", async (rig) => {
    const cookie = await rig.start()
    for (const query of ["?error=access_denied", "", "?code=a&code=b"]) {
      const reply = await rig.call("GET", `/anaf/callback${query}`, { cookie })
      assert.deepEqual([reply.status, reply.headers.get("set-cookie")], [303, null], query)
    }
    const consumed = await rig.call("GET", `/anaf/callback${CODE}`, { cookie })
    assert.match(consumed.headers.get("set-cookie") ?? "", /^qwbe_anaf_oauth=; Max-Age=0;/u)
    assert.equal((await status(rig)).status, "connected", "the foreign error answers did not cancel the started connection")
  })
})

void test("start refuses an issuer CIF the SPV cannot know, and the callback still fails one changed after start", async () => {
  await withRig("efconn_nocif", async (rig, fixture) => {
    const cookie = await rig.start()
    await fixture.pool.query("UPDATE issuers SET tax_identifier = 'RO-ABC' WHERE organization_id = 'org-1'")
    const refused = await rig.call("POST", "/efactura/connection/start")
    assert.deepEqual([refused.status, refused.body], [409, { error: "DomainConflict", code: "efactura_issuer_cif_invalid" }])
    assert.equal(refused.headers.get("set-cookie"), null)
    assert.equal(await rig.callback(cookie, CODE), "verificare_esuata", "the refused start left the earlier attempt current")
    assert.equal(rig.fake.calls.some(({ operation }) => operation === "lista"), false)
    assert.deepEqual(rig.revoked(), ["refresh-1"])
    assert.equal((await status(rig)).status, "disconnected")
  })
})

void test("two callbacks finished in reverse order: the older attempt does not overwrite the newer connection", async () => {
  await withRig("efconn_reverse", async (rig) => {
    const first = await rig.start()
    const held = rig.token.hold()
    const late = rig.callback(first, "?code=first")
    await held.reached
    assert.equal(await rig.callback(await rig.start(), "?code=second"), "conectat")
    const connected = await rig.stored()
    held.release()
    assert.equal(await late, "conexiune_schimbata")
    const after = await rig.stored()
    assert.deepEqual([after?.generation, after?.revision, accessToken(after)], [connected?.generation, connected?.revision, "access-1"])
    assert.deepEqual(rig.revoked(), ["refresh-2"], "the late pair is revoked, the kept one is not")
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected"])
  })
})

void test("a disconnect overtaking a callback wins, and a disconnect revokes after the commit", async () => {
  await withRig("efconn_disconnect", async (rig) => {
    const cookie = await rig.start()
    const held = rig.token.hold()
    const late = rig.callback(cookie, CODE)
    await held.reached
    assert.equal((await rig.call("DELETE", "/efactura/connection")).status, 200)
    held.release()
    assert.equal(await late, "conexiune_schimbata")
    assert.equal((await status(rig)).status, "disconnected")

    assert.equal(await rig.callback(await rig.start(), CODE), "conectat")
    const generation = (await rig.stored())?.generation ?? -1
    const disconnected = await rig.call("DELETE", "/efactura/connection")
    assert.deepEqual([disconnected.body.status, disconnected.body.verifiedCif, disconnected.body.attempt], ["disconnected", null, "none"])
    const stored = await rig.stored()
    assert.deepEqual([stored?.generation, stored?.tokens, stored?.identity], [generation + 1, undefined, undefined])
    assert.deepEqual(rig.revoked(), ["refresh-1", "refresh-2"], "the overtaken callback's pair, then the disconnected one")
    assert.deepEqual(await rig.audit(), ["efactura_connection.connected", "efactura_connection.disconnected"])
  })
})

void test("the routes ask for their grants, and a token that no longer opens reads as needs_reconnect", async () => {
  await withRig("efconn_grants", async (rig, fixture) => {
    assert.equal((await rig.call("GET", "/efactura/connection", { as: "none" })).status, 403)
    assert.equal((await rig.call("POST", "/efactura/connection/start", { as: "reader" })).status, 403)
    assert.equal((await rig.call("DELETE", "/efactura/connection", { as: "reader" })).status, 403)
    assert.equal((await rig.call("GET", "/efactura/connection", { as: "reader" })).status, 200)
    assert.equal(await rig.callback(await rig.start(), CODE), "conectat")
    await fixture.pool.query("UPDATE efactura_connections SET access_token_ciphertext = refresh_token_ciphertext")
    assert.equal((await rig.stored())?.tokens, "unreadable")
    assert.deepEqual([(await status(rig)).status, (await status(rig)).verifiedCif], ["needs_reconnect", ISSUER_CIF])
  })
})

void test("neither the callback's query, the cookie, the secret nor a token reaches a log, even when storage fails", async () => {
  await withRig("efconn_logs", async (rig, fixture) => {
    const cookie = await rig.start()
    assert.equal(await rig.callback(cookie, CODE), "conectat")
    rig.fake.answer("lista", "error_in_200")
    assert.equal(await rig.callback(await rig.start(), CODE), "fara_drept_cif")
    const failing = await rig.start()
    await fixture.pool.query("ALTER TABLE efactura_oauth_attempts RENAME TO efactura_oauth_attempts_gone")
    assert.equal(await rig.callback(failing, CODE), "eroare")
    assert.ok(rig.logs.some((line) => line.includes("e-Factura callback: PersistenceFailure")), rig.logs.join(""))
    const written = rig.logs.join("\n")
    for (const secret of ["AUTH-CODE-DO-NOT-LEAK", CLIENT_SECRET, cookie.split("=")[1] ?? "?", failing.split("=")[1] ?? "?", "access-", "refresh-"]) {
      assert.equal(written.includes(secret), false, secret)
    }
    await fixture.pool.query("ALTER TABLE efactura_oauth_attempts_gone RENAME TO efactura_oauth_attempts")
  })
})
