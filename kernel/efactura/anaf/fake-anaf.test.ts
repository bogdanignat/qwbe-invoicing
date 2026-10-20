import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { classifyTokenReply } from "../../../cubes/invoicing/efactura/connection/index.ts"
import {
  classifyDownload, classifyList, classifyStatus, classifyUpload, classifyValidation, parseStrictXml, type AnafReply,
} from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { failureOf } from "../../company-lookup/transport.test-support.ts"
import { SendFailure, send, type BodyDecoding } from "../../outbound/send.ts"
import { ANAF_HTTP, ANAF_OAUTH, anafApi } from "./endpoints.ts"
import { FAKE_RETRY_AFTER, FAKE_ZIP, startFakeAnaf, type FakeAnaf } from "./fake-anaf.test-support.ts"

const api = anafApi("test")
const bearer = { authorization: "Bearer access-1" }
const xmlBody = "<Invoice/>"
const window = { cif: "12345674", startTime: 1_760_000_000_000, endTime: 1_760_500_000_000, page: 1 }

const withFake = async (use: (fake: FakeAnaf) => Promise<void>) => {
  const fake = await startFakeAnaf()
  try { await use(fake) } finally { await fake.close() }
}
const request = <D extends BodyDecoding>(fake: FakeAnaf, url: string, init: RequestInit, decode: D, timeoutMs: number = ANAF_HTTP.timeoutMs) =>
  send({ transport: fake.transport, timeoutMs, maxBodyBytes: ANAF_HTTP.maxBodyBytes, decode }, url, init)
const call = <D extends BodyDecoding>(fake: FakeAnaf, url: string, init: RequestInit, decode: D) => Effect.runPromise(request(fake, url, init, decode))
const reply = <Body>(answer: { readonly status: number; readonly headers: Headers; readonly body: Body }): AnafReply<Body> =>
  ({ status: answer.status, retryAfter: answer.headers.get("retry-after"), body: answer.body })

const calls = (fake: FakeAnaf) => ({
  token: () => call(fake, ANAF_OAUTH.token, { method: "POST", body: "grant_type=authorization_code&code=abc" }, "utf8"),
  validare: () => call(fake, api.validate("FACT1"), { method: "POST", body: xmlBody }, "utf8"),
  upload: () => call(fake, api.upload("UBL", "12345674"), { method: "POST", headers: bearer, body: xmlBody }, "utf8"),
  stareMesaj: () => call(fake, api.status("5000000001"), { headers: bearer }, "utf8"),
  lista: () => call(fake, api.list(window), { headers: bearer }, "utf8"),
  descarcare: () => call(fake, api.download("3000000001"), { headers: bearer }, "bytes"),
})

void test("the fake answers like ANAF at the constant URLs, and the answers classify as the real ones would", async () => {
  await withFake(async (fake) => {
    const anaf = calls(fake)
    const token = await anaf.token()
    assert.equal(classifyTokenReply(token.status, token.body).kind, "granted")
    assert.deepEqual(classifyValidation(reply(await anaf.validare())), { kind: "valid" })
    assert.deepEqual(classifyUpload(reply(await anaf.upload())), { kind: "indexed", uploadIndex: "5000000001" })
    assert.deepEqual(classifyStatus(reply(await anaf.stareMesaj())), { kind: "accepted", downloadId: "3000000001" })
    const listed = classifyList(reply(await anaf.lista()))
    assert.ok(listed.kind === "messages" && listed.messages[0]?.uploadIndex === "5000000001")
    const download = classifyDownload(reply(await anaf.descarcare()))
    assert.ok(download.kind === "archive" && Buffer.from(download.archive).equals(FAKE_ZIP))
    assert.deepEqual(fake.calls.map(({ method, origin, path }) => `${method} ${origin}${path}`), [
      "POST https://logincert.anaf.ro/anaf-oauth2/v1/token",
      "POST https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/FACT1",
      "POST https://api.anaf.ro/test/FCTEL/rest/upload?standard=UBL&cif=12345674",
      "GET https://api.anaf.ro/test/FCTEL/rest/stareMesaj?id_incarcare=5000000001",
      `GET https://api.anaf.ro/test/FCTEL/rest/listaMesajePaginatieFactura?startTime=${String(window.startTime)}&endTime=${String(window.endTime)}&cif=12345674&pagina=1`,
      "GET https://api.anaf.ro/test/FCTEL/rest/descarcare?id=3000000001",
    ])
  })
})

void test("an error inside HTTP 200 is ANAF's answer, never a success", async () => {
  await withFake(async (fake) => {
    for (const operation of ["token", "validare", "upload", "stareMesaj", "lista", "descarcare"] as const) fake.answer(operation, "error_in_200")
    const anaf = calls(fake)
    const token = await anaf.token()
    assert.deepEqual(classifyTokenReply(token.status, token.body), { kind: "invalid_grant" })
    assert.equal(classifyValidation(reply(await anaf.validare())).kind, "invalid")
    assert.equal(classifyUpload(reply(await anaf.upload())).kind, "refused")
    assert.equal(classifyStatus(reply(await anaf.stareMesaj())).kind, "anaf_error")
    assert.equal(classifyList(reply(await anaf.lista())).kind, "no_right")
    assert.equal(classifyDownload(reply(await anaf.descarcare())).kind, "anaf_error")
  })
})

void test("a 429 is a throttle with ANAF's numeric Retry-After; on upload it decides nothing", async () => {
  await withFake(async (fake) => {
    for (const operation of ["upload", "stareMesaj"] as const) fake.answer(operation, "rate_limited")
    const anaf = calls(fake)
    assert.deepEqual(classifyStatus(reply(await anaf.stareMesaj())), { kind: "rate_limited", retryAfterSeconds: Number(FAKE_RETRY_AFTER) })
    assert.deepEqual(classifyUpload(reply(await anaf.upload())), { kind: "ambiguous" })
  })
})

void test("a request read and never answered, a redirect or a body past 11 MB fail as ambiguous", async () => {
  await withFake(async (fake) => {
    const ambiguous = async (attempt: ReturnType<typeof request>) => {
      const { failure } = await failureOf(attempt)
      assert.ok(failure instanceof SendFailure && failure.reason === "ambiguous")
    }
    fake.answer("upload", "timeout_after_send")
    await ambiguous(request(fake, api.upload("UBL", "12345674"), { method: "POST", headers: bearer, body: xmlBody }, "utf8", 300))
    assert.equal(fake.calls.at(-1)?.body.toString("utf8"), xmlBody, "the fake did receive the upload")
    fake.answer("stareMesaj", "redirect")
    await ambiguous(request(fake, api.status("5000000001"), { headers: bearer }, "utf8"))
    fake.answer("descarcare", "oversized")
    await ambiguous(request(fake, api.download("3000000001"), { headers: bearer }, "bytes"))
  })
})

void test("an XML answer with a DOCTYPE is refused before any entity is read", async () => {
  await withFake(async (fake) => {
    for (const operation of ["upload", "stareMesaj"] as const) fake.answer(operation, "dtd")
    const anaf = calls(fake)
    const upload = await anaf.upload()
    assert.deepEqual(parseStrictXml(upload.body), { ok: false, refusal: "doctype" })
    assert.deepEqual(classifyUpload(reply(upload)), { kind: "ambiguous" })
    assert.deepEqual(classifyStatus(reply(await anaf.stareMesaj())), { kind: "unrecognized" })
  })
})

void test("the fake transport reaches only ANAF's three hosts, and the API wants a token", async () => {
  await withFake(async (fake) => {
    await assert.rejects(fake.transport("https://example.com/", {}), /refuses https:\/\/example.com/u)
    const testValidare = await call(fake, "https://api.anaf.ro/test/FCTEL/rest/validare/FACT1", { method: "POST", headers: bearer, body: xmlBody }, "utf8")
    assert.equal(testValidare.status, 404, "as on ANAF TEST, validare is not served under api.anaf.ro")
    const anonymous = await call(fake, api.status("1"), {}, "utf8")
    assert.equal(anonymous.status, 401)
    assert.deepEqual(classifyStatus(reply(anonymous)), { kind: "auth_refused" })
    const revoke = await call(fake, ANAF_OAUTH.revoke, { method: "POST", body: "token=refresh-1" }, "utf8")
    assert.equal(revoke.status, 200)
  })
})
