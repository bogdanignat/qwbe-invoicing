import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"

import { Effect, Redacted } from "effect"
import type { Pool } from "pg"

import { AuthenticationRequired, invoicingPermissions } from "../../../cubes/invoicing/index.ts"
import { efacturaPermissions, type ConnectionRecord } from "../../../cubes/invoicing/efactura/connection/index.ts"
import { createApiHandler } from "../../api/api.ts"
import type { RequestAuthenticator } from "../../auth/auth.ts"
import type { Transport } from "../../outbound/send.ts"
import { allPlugins } from "../../plugins.ts"
import type { AnafSettings } from "./config.ts"
import { connectionHost } from "./connection-host.ts"
import { startFakeAnaf, type FakeAnaf } from "./fake-anaf.test-support.ts"

export const ORG = "org-1"
export const CLIENT_SECRET = "client-secret-DO-NOT-LEAK-7f3a"
export const ISSUER_CIF = "12345674"

export const anafSettingsFor = (overrides: { readonly clientId?: string } = {}): AnafSettings => ({
  environment: "test",
  client: { clientId: overrides.clientId ?? "qwbe_test_client", redirectUri: "https://invoice.test/api/anaf/callback",
    clientSecret: Redacted.make(CLIENT_SECRET), tokenKey: Redacted.make(randomBytes(32)) },
})

/** The issuer whose CIF the callback verifies, written through the API like the Settings page does. */
export const ISSUER = { name: "Furnizor SRL", fiscalIdentifier: ISSUER_CIF,
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl",
  tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
  socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15,
  vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null }

/**
 * A transport that holds the next calls to one ANAF path until released, so a
 * test can order two flows exactly: `reached` says the call is parked at the
 * gate, `release` lets it go on to the fake.
 */
export const gated = (transport: Transport, path: string) => {
  const queue: Array<{ readonly reached: () => void; readonly released: Promise<void> }> = []
  return {
    transport: (async (url, init) => {
      const next = new URL(url).pathname.endsWith(path) ? queue.shift() : undefined
      if (next !== undefined) {
        next.reached()
        await next.released
      }
      return transport(url, init)
    }) satisfies Transport,
    hold: () => {
      let reached = () => {}
      let release = () => {}
      const arrived = new Promise<void>((resolve) => { reached = resolve })
      queue.push({ reached, released: new Promise<void>((resolve) => { release = resolve }) })
      return { reached: arrived, release: () => { release() } }
    },
  }
}

const grants: Readonly<Record<string, ReadonlyArray<string>>> = {
  owner: [invoicingPermissions("invoicing").manageSettings, efacturaPermissions("efactura").read, efacturaPermissions("efactura").manageConnection],
  reader: [efacturaPermissions("efactura").read],
  none: [],
}

const authenticate: RequestAuthenticator = (authorization) => ({
  current: Effect.suspend(() => {
    const permissions = grants[authorization?.replace(/^Bearer /u, "") ?? ""]
    return permissions === undefined ? Effect.fail(new AuthenticationRequired())
      : Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions }, organization: { id: ORG } })
  }),
})

export interface Reply {
  readonly status: number
  readonly headers: Headers
  readonly body: Record<string, unknown>
}

/**
 * The API handler on a real database with the fake ANAF behind a gate on the
 * token endpoint. Every byte written to stdout/stderr is kept in `logs`; the
 * clock is the test's.
 */
export const connectionRig = async (pool: Pool, dataDirectory: string, settings: AnafSettings = anafSettingsFor()) => {
  const fake: FakeAnaf = await startFakeAnaf()
  const token = gated(fake.transport, "/token")
  const clock = { now: Date.parse("2026-10-19T12:00:00.000Z") }
  const now = () => new Date(clock.now)
  const handler = createApiHandler({ authenticate, pool, dataDirectory, plugins: allPlugins, transport: token.transport, anaf: settings, now })
  const logs: Array<string> = []
  const capture = async <T>(run: () => Promise<T>): Promise<T> => {
    const [out, err] = [process.stdout.write.bind(process.stdout), process.stderr.write.bind(process.stderr)]
    const keep = (write: typeof out) => ((chunk: unknown, ...rest: Array<unknown>) => {
      logs.push(String(chunk))
      return (write as (...args: Array<unknown>) => boolean)(chunk, ...rest)
    }) as typeof out
    process.stdout.write = keep(out)
    process.stderr.write = keep(err)
    try { return await run() } finally {
      process.stdout.write = out
      process.stderr.write = err
    }
  }
  const call = (method: string, path: string, options: { readonly cookie?: string; readonly as?: string; readonly body?: unknown } = {}) =>
    capture(async (): Promise<Reply> => {
      const headers: Record<string, string> = { "content-type": "application/json" }
      if (options.cookie !== undefined) headers.cookie = options.cookie
      if (!path.startsWith("/anaf/")) headers.authorization = `Bearer ${options.as ?? "owner"}`
      const response = await handler.handle(new Request(`http://qwbe.local/api${path}`, { method, headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }))
      const text = await response.text()
      return { status: response.status, headers: response.headers, body: text === "" ? {} : JSON.parse(text) as Record<string, unknown> }
    })
  const dispose = async () => { await handler.dispose(); await fake.close() }
  const issuer = await call("PUT", "/issuer", { body: ISSUER })
  if (issuer.status !== 200) {
    await dispose()
    assert.fail(`issuer: ${JSON.stringify(issuer.body)}`)
  }

  /** `POST /efactura/connection/start`, answering the `cookie` header the callback will carry. */
  const start = async (): Promise<string> => {
    const started = await call("POST", "/efactura/connection/start")
    assert.equal(started.status, 200, JSON.stringify(started.body))
    const cookie = started.headers.get("set-cookie") ?? ""
    return cookie.split(";", 1)[0] ?? ""
  }
  /** The callback's fixed code, read off the 303's `Location`. */
  const callback = async (cookie: string | undefined, query: string): Promise<string> => {
    const reply = await call("GET", `/anaf/callback${query}`, cookie === undefined ? {} : { cookie })
    assert.equal(reply.status, 303)
    return new URL(reply.headers.get("location") ?? "", "http://qwbe.local").searchParams.get("anaf") ?? ""
  }
  const host = connectionHost(pool, settings, token.transport, now)
  const stored = (): Promise<ConnectionRecord | undefined> => Effect.runPromise(host.store.transaction((t) => t.findConnection(ORG)))
  const audit = async (): Promise<ReadonlyArray<string>> => (await pool.query<{ readonly action: string; readonly reason: string | null }>(
    "SELECT action, reason FROM audit_events WHERE target_kind = 'efactura_connection' ORDER BY occurred_at, action",
  )).rows.map(({ action, reason }) => reason === null ? action : `${action}:${reason}`)

  /** The refresh tokens ANAF was asked to revoke, in order. */
  const revoked = (): ReadonlyArray<string | null> => fake.calls.filter(({ operation }) => operation === "revoke")
    .map(({ body }) => new URLSearchParams(body.toString("utf8")).get("token"))

  return {
    call, capture, logs, fake, token, clock, host, start, callback, stored, audit, revoked, dispose,
  }
}

export type ConnectionRig = Awaited<ReturnType<typeof connectionRig>>

export const accessToken = (record: ConnectionRecord | undefined): string | undefined =>
  typeof record?.tokens === "object" ? Redacted.value(record.tokens.access) : undefined
