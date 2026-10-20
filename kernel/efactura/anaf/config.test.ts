import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { inspect } from "node:util"
import { join } from "node:path"
import test, { type TestContext } from "node:test"

import { Redacted } from "effect"

import { runtimeConfig } from "../../config.ts"
import { anafSettings } from "./config.ts"
import { ANAF_API_BASES, ANAF_OAUTH, anafApi } from "./endpoints.ts"

const SECRET = "client-secret-value-1234"

const files = (t: TestContext) => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-anaf-"))
  t.after(() => { rmSync(directory, { recursive: true, force: true }) })
  const file = (name: string, content: string) => {
    const path = join(directory, name)
    writeFileSync(path, content, { mode: 0o600 })
    return path
  }
  const tokenKey = randomBytes(32).toString("hex")
  return {
    directory, file, tokenKey,
    complete: {
      ANAF_CLIENT_ID: "synthetic-anaf-client-0000aaaa1111bbbb",
      ANAF_REDIRECT_URI: "https://invoice.test/api/anaf/callback",
      ANAF_CLIENT_SECRET_FILE: file("client-secret", `${SECRET}\n`),
      ANAF_TOKEN_KEY_FILE: file("token-key", `${tokenKey}\n`),
    },
  }
}

void test("nothing set: not configured, and the environment is test", () => {
  assert.deepEqual(anafSettings({}, undefined), { environment: "test", client: undefined })
  assert.deepEqual(anafSettings({ ANAF_ENVIRONMENT: "" }, undefined), { environment: "test", client: undefined })
  assert.deepEqual(runtimeConfig({ NODE_ENV: "test" }).anaf, { environment: "test", client: undefined })
})

void test("prod only when written out; any other spelling refuses to start", () => {
  assert.equal(anafSettings({ ANAF_ENVIRONMENT: "prod" }, undefined).environment, "prod")
  for (const value of ["PROD", "production", "Test", " test", "staging"]) {
    assert.throws(() => anafSettings({ ANAF_ENVIRONMENT: value }, undefined), /ANAF_ENVIRONMENT must be test or prod/u, value)
    assert.throws(() => runtimeConfig({ NODE_ENV: "test", ANAF_ENVIRONMENT: value }), /ANAF_ENVIRONMENT/u, value)
  }
})

void test("the URLs are constants: test is api.anaf.ro/test, prod is api.anaf.ro/prod, validare is public in both, OAuth is logincert", () => {
  assert.equal(ANAF_API_BASES.test, "https://api.anaf.ro/test/FCTEL/rest")
  assert.equal(ANAF_API_BASES.prod, "https://api.anaf.ro/prod/FCTEL/rest")
  assert.equal(anafApi("test").upload("CN", "12345674"), "https://api.anaf.ro/test/FCTEL/rest/upload?standard=CN&cif=12345674")
  for (const environment of ["test", "prod"] as const) {
    assert.equal(anafApi(environment).validate("FCN"), "https://webservicesp.anaf.ro/prod/FCTEL/rest/validare/FCN", "validare is the public validator")
  }
  assert.equal(anafApi("test").status("1&x=2"), "https://api.anaf.ro/test/FCTEL/rest/stareMesaj?id_incarcare=1%26x%3D2")
  assert.deepEqual(ANAF_OAUTH, {
    authorize: "https://logincert.anaf.ro/anaf-oauth2/v1/authorize",
    token: "https://logincert.anaf.ro/anaf-oauth2/v1/token",
    revoke: "https://logincert.anaf.ro/anaf-oauth2/v1/revoke",
  })
})

void test("all four client variables read the client, the secrets redacted", (t) => {
  const { complete, tokenKey } = files(t)
  const { client } = anafSettings(complete, "https://invoice.test")
  assert.ok(client !== undefined)
  assert.equal(client.clientId, complete.ANAF_CLIENT_ID)
  assert.equal(client.redirectUri, complete.ANAF_REDIRECT_URI)
  assert.equal(Redacted.value(client.clientSecret), SECRET)
  assert.equal(Redacted.value(client.tokenKey).toString("hex"), tokenKey)
  const printed = `${JSON.stringify(client)} ${inspect(client, { depth: 5 })}`
  assert.equal(printed.includes(SECRET) || printed.includes(tokenKey), false)
})

void test("a partial setup refuses to start and names what is missing; an empty value is unset", (t) => {
  const { complete } = files(t)
  const names = Object.keys(complete) as ReadonlyArray<keyof typeof complete>
  for (const name of names) {
    const partial = { ...complete, [name]: undefined }
    assert.throws(() => anafSettings(partial, undefined), new RegExp(`partly configured; also set ${name} \\(all four or none\\)`, "u"), name)
    assert.throws(() => anafSettings({ ...complete, [name]: "" }, undefined), /partly configured/u, `${name} empty`)
    assert.throws(() => anafSettings({ [name]: complete[name] }, undefined), /partly configured/u, `only ${name}`)
  }
  assert.throws(() => runtimeConfig({ NODE_ENV: "test", ANAF_CLIENT_ID: complete.ANAF_CLIENT_ID }), /partly configured/u)
})

void test("an invalid client id or redirect URI refuses to start", (t) => {
  const { complete } = files(t)
  for (const clientId of ["short", "has space here", "x".repeat(129), "id;drop"]) {
    assert.throws(() => anafSettings({ ...complete, ANAF_CLIENT_ID: clientId }, undefined), /ANAF_CLIENT_ID must be/u, clientId)
  }
  for (const uri of ["http://invoice.test/api/anaf/callback", "https://invoice.test/api/anaf/callback/", "https://invoice.test/api/anaf/callback?x=1",
    "https://invoice.test/api/anaf/callback#x", "https://user:pw@invoice.test/api/anaf/callback", "https://INVOICE.test/api/anaf/callback",
    "https://invoice.test/api/other", "invoice.test/api/anaf/callback", "not a url"]) {
    assert.throws(() => anafSettings({ ...complete, ANAF_REDIRECT_URI: uri }, undefined), /ANAF_REDIRECT_URI must be exactly/u, uri)
  }
  assert.throws(() => anafSettings(complete, "https://facturare.example.ro"), /ANAF_REDIRECT_URI must be on PUBLIC_ORIGIN/u)
  assert.ok(anafSettings(complete, "https://invoice.test").client)
})

void test("the secret files fail closed with the path only, never their contents", (t) => {
  const { complete, file, directory, tokenKey } = files(t)
  const refused = (overrides: Partial<typeof complete>, pattern: RegExp, hidden: string) => {
    assert.throws(() => anafSettings({ ...complete, ...overrides }, undefined), (error: Error) => pattern.test(error.message) && !error.message.includes(hidden))
  }
  refused({ ANAF_CLIENT_SECRET_FILE: join(directory, "missing") }, /ANAF_CLIENT_SECRET_FILE is not readable/u, SECRET)
  refused({ ANAF_CLIENT_SECRET_FILE: file("empty", "\n") }, /ANAF_CLIENT_SECRET_FILE must hold one line/u, SECRET)
  refused({ ANAF_CLIENT_SECRET_FILE: file("two-lines", `${SECRET}\nsecond-line-secret`) }, /ANAF_CLIENT_SECRET_FILE must hold one line/u, "second-line-secret")
  refused({ ANAF_TOKEN_KEY_FILE: join(directory, "missing-key") }, /ANAF_TOKEN_KEY_FILE is not readable/u, tokenKey)
  refused({ ANAF_TOKEN_KEY_FILE: file("short-key", tokenKey.slice(0, 62)) }, /ANAF_TOKEN_KEY_FILE must hold 64 hex characters/u, tokenKey.slice(0, 62))
})

void test("the token key is its own key, never the company-lookup one", (t) => {
  const { complete } = files(t)
  const environment = { NODE_ENV: "test", ...complete }
  assert.ok(runtimeConfig(environment).anaf?.client)
  assert.throws(() => runtimeConfig({ ...environment, COMPANY_LOOKUP_KEY_FILE: complete.ANAF_TOKEN_KEY_FILE }), /ANAF_TOKEN_KEY_FILE must hold its own key/u)
})
