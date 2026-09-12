import assert from "node:assert/strict"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { request as httpRequest, IncomingMessage, ServerResponse, type ClientRequest, type Server } from "node:http"
import { Socket, type AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { startServer } from "./http.ts"
import { applyMigrations } from "./migrations.ts"

const token = "http-throttle-secret-canary-".repeat(3)
const wrongToken = "wrong-token-body-canary"
const rawPeer = "::ffff:198.51.100.77"
const normalizedPeer = "198.51.100.77"
const monthMs = 30 * 24 * 60 * 60 * 1_000

interface Fixture {
  readonly server: Server
  readonly origin: string
  readonly events: unknown[]
  readonly setPeer: (value: string | undefined) => void
  readonly advance: (milliseconds: number) => void
}

interface FixtureOptions {
  readonly defaultPeer?: boolean
  readonly loggerThrows?: boolean
  readonly onPeerKey?: (request: IncomingMessage) => void
}

const withFixture = async (run: (fixture: Fixture) => Promise<void>, options: FixtureOptions = {}): Promise<void> => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-http-throttle-"))
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  let currentTime = 1_800_000_000_000
  let peer: string | undefined = rawPeer
  const events: unknown[] = []
  const deps = {
    now: () => currentTime,
    monotonicNow: () => currentTime,
    securityLogger: (event: unknown) => {
      events.push(event)
      if (options.loggerThrows === true) throw new Error("simulated security logger failure")
    },
    ...(options.defaultPeer === true ? {} : { peerKey: (request: IncomingMessage) => {
      options.onPeerKey?.(request)
      return peer
    } }),
  }
  const server = startServer({
    host: "127.0.0.1", port: 0, dataDirectory: directory,
    nodeEnvironment: "test", authTokenFile: tokenFile, organizationId: "org-1",
  }, () => true, undefined, deps)
  try {
    if (!server.listening) await once(server, "listening")
    const address = server.address() as AddressInfo
    await run({
      server,
      origin: `http://127.0.0.1:${String(address.port)}`,
      events,
      setPeer: (value) => { peer = value },
      advance: (milliseconds) => { currentTime += milliseconds },
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => { if (error === undefined) resolve(); else reject(error) })
    })
    rmSync(directory, { recursive: true, force: true })
  }
}

const drain = async (response: Response): Promise<number> => {
  await response.arrayBuffer()
  return response.status
}

const bearer = (
  fixture: Fixture,
  suppliedToken = wrongToken,
  path = "/api/customers",
  extraHeaders: Readonly<Record<string, string>> = {},
) =>
  fetch(`${fixture.origin}${path}`, {
    headers: { authorization: `Bearer ${suppliedToken}`, ...extraHeaders },
  })

const browserLogin = (
  fixture: Fixture,
  suppliedToken = wrongToken,
  extraHeaders: Readonly<Record<string, string>> = {},
) =>
  fetch(`${fixture.origin}/api/session`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: fixture.origin, ...extraHeaders },
    body: JSON.stringify({ token: suppliedToken }),
  })

const failSixTimes = async (fixture: Fixture): Promise<void> => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = attempt % 2 === 0 ? await browserLogin(fixture) : await bearer(fixture)
    assert.equal(response.status, 401)
    assert.deepEqual(await response.json(), {
      error: attempt % 2 === 0 ? "invalid_credentials" : "AuthenticationRequired",
    })
  }
}

const assertThrottled = async (response: Response, retryAfter: number): Promise<void> => {
  assert.equal(response.status, 429)
  assert.equal(response.headers.get("retry-after"), String(retryAfter))
  assert.deepEqual(await response.json(), { error: "too_many_attempts" })
}

void test("browser and Bearer failures share a cooldown that cannot be bypassed via forwarded headers", async () => {
  await withFixture(async (fixture) => {
    await failSixTimes(fixture)
    await assertThrottled(await bearer(fixture, token, "/api/customers", {
      "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.10",
    }), 1)
    await assertThrottled(await browserLogin(fixture, token, {
      "x-forwarded-for": "192.0.2.11", "x-real-ip": "192.0.2.12",
    }), 1)
  }, { defaultPeer: true })
})

void test("cooldowns start on the sixth failure, double to 30 seconds, do not extend on 429, and reset after success", async () => {
  await withFixture(async (fixture) => {
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    assert.equal(await drain(await browserLogin(fixture)), 401)
    for (const seconds of [1, 2, 4, 8, 16, 30, 30]) {
      fixture.advance(seconds * 1_000 - 1)
      await assertThrottled(await bearer(fixture, token), 1)
      fixture.advance(1)
      assert.equal(await drain(await bearer(fixture)), 401)
      await assertThrottled(await browserLogin(fixture, token), Math.min(seconds * 2, 30))
    }
    fixture.advance(30_000)
    assert.equal(await drain(await bearer(fixture, token)), 200)
    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("invalid input, rejected origins, CSRF failures, missing auth, and expired cookies do not consume attempts", async () => {
  await withFixture(async (fixture) => {
    const login = await browserLogin(fixture, token)
    assert.equal(login.status, 200)
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]
    assert.ok(cookie)
    const csrfToken = (await login.json() as { readonly csrfToken: string }).csrfToken

    const malformed = await fetch(`${fixture.origin}/api/session`, {
      method: "POST", headers: { "content-type": "application/json", origin: fixture.origin }, body: "{",
    })
    assert.equal(await drain(malformed), 400)
    for (const body of [{}, { token: "" }, { token: "   " }, { token: 7 }]) {
      assert.equal(await drain(await fetch(`${fixture.origin}/api/session`, {
        method: "POST", headers: { "content-type": "application/json", origin: fixture.origin }, body: JSON.stringify(body),
      })), 400)
    }
    assert.equal(await drain(await fetch(`${fixture.origin}/api/session`, {
      method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      body: JSON.stringify({ token: wrongToken }),
    })), 403)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`, {
      method: "POST", headers: { cookie, origin: fixture.origin, "x-csrf-token": `${csrfToken}x` }, body: "{}",
    })), 403)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`)), 401)
    for (const authorization of ["Basic abc", "Bearer", "bearer wrong"]) {
      assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`, { headers: { authorization } })), 401)
    }
    fixture.advance(monthMs + 1)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`, { headers: { cookie } })), 401)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/session`, {
      method: "POST", headers: { "content-type": "application/json", origin: fixture.origin }, body: `{"token":"${"x".repeat(1_000_001)}"}`,
    })), 413)

    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("successful credentials reset failures even when the authenticated API result is a business 404 or 400", async () => {
  await withFixture(async (fixture) => {
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    assert.equal(await drain(await browserLogin(fixture, token)), 200)
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    assert.equal(await drain(await bearer(fixture, token, "/api/not-a-route")), 404)
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    assert.equal(await drain(await bearer(fixture, token, "/api/customers?limit=not-a-number")), 400)
    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("non-Bearer and empty credentials do not consume the Bearer failure allowance", async () => {
  await withFixture(async (fixture) => {
    for (const authorization of ["Basic abc", "Bearer", "bearer wrong", "Bearer ", "Digest abc", "Basic xyz"]) {
      assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`, { headers: { authorization } })), 401)
    }
    for (let attempt = 0; attempt < 6; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("cookie session routes remain available during cooldown while valid Bearer requests are blocked", async () => {
  await withFixture(async (fixture) => {
    const login = await browserLogin(fixture, token)
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]
    assert.ok(cookie)
    const csrfToken = (await login.json() as { readonly csrfToken: string }).csrfToken
    await failSixTimes(fixture)

    assert.equal(await drain(await fetch(`${fixture.origin}/api/session`, { headers: { cookie } })), 200)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/customers`, { headers: { cookie } })), 200)
    assert.equal(await drain(await fetch(`${fixture.origin}/api`, { headers: { cookie } })), 200)
    assert.equal(await drain(await fetch(`${fixture.origin}/api/session`, {
      method: "DELETE", headers: { cookie, origin: fixture.origin, "x-csrf-token": csrfToken },
    })), 200)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("the injected peer key aggregates NAT callers, separates peers, and treats forwarded addresses as data", async () => {
  await withFixture(async (fixture) => {
    await failSixTimes(fixture)
    fixture.setPeer(normalizedPeer)
    await assertThrottled(await bearer(fixture, token, "/api/customers", {
      "x-forwarded-for": "203.0.113.200", "x-real-ip": "203.0.113.201",
    }), 1)
    fixture.setPeer("203.0.113.55")
    assert.equal(await drain(await bearer(fixture, token)), 200)
    fixture.setPeer(rawPeer)
    await assertThrottled(await bearer(fixture, token), 1)
  })
})

void test("concurrent credential failures cannot all pass before cooldown activation", async () => {
  await withFixture(async (fixture) => {
    const statuses = await Promise.all(Array.from({ length: 20 }, async () => drain(await bearer(fixture))))
    assert.equal(statuses.filter((status) => status === 401).length, 6)
    assert.equal(statuses.filter((status) => status === 429).length, 14)
  })
})

void test("same-turn request admission cannot race failed credential accounting across microtasks", async () => {
  await withFixture(async (fixture) => {
    const results = Array.from({ length: 20 }, () => new Promise<number>((resolve) => {
      const request = new IncomingMessage(new Socket())
      request.method = "GET"
      request.url = "/api/customers"
      request.headers.authorization = `Bearer ${wrongToken}`
      const response = new ServerResponse(request)
      response.end = () => { resolve(response.statusCode); return response }
      // All requests enter before any readBody/authentication promise resumes.
      // Unlike separate socket events, this deterministically aligns admission.
      fixture.server.emit("request", request, response)
    }))
    const statuses = await Promise.all(results)
    assert.equal(statuses.filter((status) => status === 401).length, 6)
    assert.equal(statuses.filter((status) => status === 429).length, 14)
  })
})

void test("an active cooldown rejects a session POST before waiting for its body", async () => {
  await withFixture(async (fixture) => {
    await failSixTimes(fixture)
    const request = httpRequest(`${fixture.origin}/api/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.origin },
    })
    const result = new Promise<{ readonly status: number, readonly body: string }>((resolve, reject) => {
      request.on("response", (incoming) => {
        const chunks: Buffer[] = []
        incoming.on("data", (chunk: Buffer) => { chunks.push(chunk) })
        incoming.on("end", () => {
          resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        })
      })
      request.on("error", reject)
    })
    void result.catch(() => undefined)
    const deadline = setTimeout(() => { request.destroy(new Error("cooldown waited for unfinished body")) }, 2_000)
    try {
      request.write('{"token":"')
      assert.deepEqual(await result, { status: 429, body: '{"error":"too_many_attempts"}\n' })
    } finally {
      clearTimeout(deadline)
      request.destroy()
    }
  })
})

void test("a POST admitted before cooldown is checked again after its slow body completes", async () => {
  let admitted!: () => void
  const wasAdmitted = new Promise<void>((resolve) => { admitted = resolve })
  await withFixture(async (fixture) => {
    let slowRequest: ClientRequest | undefined
    const result = new Promise<{ readonly status: number, readonly body: string }>((resolve, reject) => {
      slowRequest = httpRequest(`${fixture.origin}/api/session`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: fixture.origin, "x-test-slow-body": "yes" },
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on("data", (chunk: Buffer) => { chunks.push(chunk) })
        incoming.on("end", () => { resolve({ status: incoming.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }) })
      })
      slowRequest.on("error", reject)
    })
    assert.ok(slowRequest)
    slowRequest.write('{"token":"')
    await wasAdmitted
    await failSixTimes(fixture)
    slowRequest.end(`${wrongToken}"}`)
    assert.deepEqual(await result, { status: 429, body: '{"error":"too_many_attempts"}\n' })
  }, { onPeerKey: (request) => {
    if (request.headers["x-test-slow-body"] === "yes") admitted()
  } })
})

void test("security logging is bounded and redacted, and logger failures never alter authentication state", async () => {
  await withFixture(async (fixture) => {
    await failSixTimes(fixture)
    const afterActivation = fixture.events.length
    await assertThrottled(await bearer(fixture, token, `/api/customers?query=${token}`, {
      cookie: `qwbe_session=${token}`,
    }), 1)
    const afterFirstBlocked = fixture.events.length
    await assertThrottled(await browserLogin(fixture, token), 1)
    assert.ok(afterFirstBlocked - afterActivation <= 1)
    assert.equal(fixture.events.length, afterFirstBlocked)
    assert.ok(fixture.events.length > 0)
    const serialized = JSON.stringify(fixture.events)
    assert.doesNotMatch(serialized, new RegExp(token, "g"))
    assert.doesNotMatch(serialized, new RegExp(wrongToken, "g"))
    assert.doesNotMatch(serialized, new RegExp(rawPeer.replaceAll(".", "\\."), "g"))
    assert.doesNotMatch(serialized, new RegExp(normalizedPeer.replaceAll(".", "\\."), "g"))
    for (const event of fixture.events) assert.doesNotThrow(() => JSON.stringify(event))
  })

  await withFixture(async (fixture) => {
    await failSixTimes(fixture)
    await assertThrottled(await bearer(fixture, token), 1)
    fixture.advance(1_000)
    assert.equal(await drain(await bearer(fixture, token)), 200)
    for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(await drain(await bearer(fixture)), 401)
  }, { loggerThrows: true })
})
