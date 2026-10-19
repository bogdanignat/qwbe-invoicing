import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Pool } from "pg"

import type { ApiHandler } from "../api/api.ts"
import type { RuntimeConfig } from "../config.ts"
import { allPlugins } from "../plugins.ts"
import type { ApiDocsResponse } from "./api-docs.ts"
import { startServer, type RunningServer, type ServerDependencies } from "./http.ts"
import { parseTrustedProxies } from "./trusted-proxy.ts"

/**
 * The real server — listener, edge guard, deadline, transport bounds — with the
 * API handler and readiness stubbed, so the edge is measured without a database.
 * The pool is never queried: a session cookie that is not a well-formed id is
 * rejected before the store is consulted, and nothing else here reaches it.
 */
export const edgeToken = "e".repeat(64)
export const publicOrigin = "https://invoice.test"
export const publicHost = "invoice.test"

export interface EdgeServer extends RunningServer {
  readonly port: number
  /** Every `Request` the stub API handler was given, in order. */
  readonly seen: ReadonlyArray<Request>
}

export interface EdgeServerOptions {
  readonly config?: Partial<RuntimeConfig>
  readonly handle?: (request: Request) => Promise<Response>
  readonly isReady?: () => Promise<boolean>
  readonly renderApiDocs?: () => Promise<ApiDocsResponse>
  readonly dependencies?: ServerDependencies
  /** Never queried unless a test hands in one that is: the default has no methods at all. */
  readonly pool?: Pool
}

export const edgeConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig => {
  const directory = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "qwbe-edge-"))
  const authTokenFile = join(directory, "api-token")
  writeFileSync(authTokenFile, edgeToken, { mode: 0o600 })
  return {
    host: "127.0.0.1",
    port: 0,
    dataDirectory: directory,
    nodeEnvironment: "test",
    authTokenFile,
    organizationId: "org-edge",
    pgSettings: { host: "127.0.0.1", port: 1, database: "unused", user: "unused", password: "" },
    plugins: allPlugins,
    publicOrigin,
    bearerApi: false,
    trustedProxies: parseTrustedProxies(undefined),
    ...overrides,
  }
}

export const startEdgeServer = async (options: EdgeServerOptions = {}): Promise<EdgeServer> => {
  const seen: Array<Request> = []
  const handle = options.handle ?? (() => Promise.resolve(Response.json({ ok: true })))
  const api = (): ApiHandler => ({
    handle: (request) => { seen.push(request); return handle(request) },
    dispose: () => Promise.resolve(),
  })
  const running = await startServer(
    edgeConfig(options.config),
    options.pool ?? ({} as Pool),
    options.isReady ?? (() => Promise.resolve(true)),
    options.renderApiDocs ?? (() => Promise.resolve({ status: 200, body: new Uint8Array(), headers: {} })),
    { apiHandlerFactory: api, ...options.dependencies },
  )
  const address = running.server.address()
  if (address === null || typeof address === "string") throw new Error("the edge server did not bind a TCP port")
  return { ...running, port: address.port, seen }
}
