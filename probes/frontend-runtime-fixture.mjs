import { spawn } from "node:child_process"
import { Buffer } from "node:buffer"
import { once } from "node:events"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request as nodeRequest } from "node:http"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { setTimeout } from "node:timers"
import { fileURLToPath, URL } from "node:url"

import { startServer } from "../standalone/http/http.ts"
import { applyMigrations } from "../standalone/storage/migrations.ts"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const standaloneServer = join(repositoryRoot, "frontend/.next/standalone/frontend/server.js")
const runtimeValidator = join(repositoryRoot, "frontend/scripts/validate-runtime.mjs")
const maximumLogBytes = 16_384

const listen = async (server) => {
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("fixture did not bind a TCP port")
  return address.port
}

const closeHttpServer = async (server, sockets = new Set()) => {
  for (const socket of sockets) socket.destroy()
  if (server.listening) await new Promise((resolveClose) => server.close(resolveClose))
}

export const reservePort = async () => {
  const server = createServer()
  const port = await listen(server)
  await closeHttpServer(server)
  return port
}

export const httpRequest = ({ origin, path, method = "GET", headers = {}, chunks = [], timeoutMs = 5_000 }) =>
  new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(path, origin)
    const request = nodeRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`,
      method, headers, agent: false }, (response) => {
      const responseChunks = []
      response.on("data", (chunk) => responseChunks.push(chunk))
      response.once("end", () => resolveRequest({ status: response.statusCode ?? 0, headers: response.headers,
        rawHeaders: response.rawHeaders, body: Buffer.concat(responseChunks) }))
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`request exceeded ${String(timeoutMs)}ms`)))
    request.once("error", rejectRequest)
    for (const chunk of chunks) request.write(chunk)
    request.end()
  })

const waitFor = async (predicate, timeoutMs, intervalMs = 25) => {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (error) { lastError = error }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs))
  }
  throw lastError instanceof Error ? lastError : new Error(`condition not met within ${String(timeoutMs)}ms`)
}

const safeLogs = (value) => value
  .replaceAll(/qwbe_session=[^;\s]+/gu, "qwbe_session=[redacted]")
  .replaceAll(/[A-Za-z0-9_-]{64}/gu, "[redacted]")
  .slice(-maximumLogBytes)

export const startFrontend = async (upstreamOrigin) => {
  const port = await reservePort()
  const origin = `http://127.0.0.1:${String(port)}`
  const child = spawn(process.execPath, ["--import", runtimeValidator, standaloneServer], {
    cwd: join(repositoryRoot, "frontend"),
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
      FRONTEND_ORIGIN: origin, INVOICING_API_URL: upstreamOrigin },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let logs = ""
  const capture = (chunk) => { logs = safeLogs(`${logs}${String(chunk)}`) }
  child.stdout.on("data", capture)
  child.stderr.on("data", capture)
  const exited = new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })))
  const stopChild = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill("SIGTERM")
    const stopped = await Promise.race([exited.then(() => true), new Promise((resolveDelay) => setTimeout(() => resolveDelay(false), 2_000))])
    if (!stopped && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
    if (!stopped) await Promise.race([exited, new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000))])
  }
  try {
    await Promise.race([
      waitFor(async () => (await httpRequest({ origin, path: "/healthz", timeoutMs: 500 })).status === 200, 20_000),
      exited.then(({ code, signal }) => { throw new Error(`standalone server exited (${String(code)}/${String(signal)})\n${logs}`) }),
    ])
  } catch (error) {
    await stopChild()
    throw error
  }
  return { origin, close: stopChild, logs: () => logs }
}

export const startBackendFixture = async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-frontend-runtime-"))
  const token = "r".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  applyMigrations(directory)
  const backend = await startServer({ host: "127.0.0.1", port: 0, dataDirectory: directory,
    nodeEnvironment: "production", authTokenFile: tokenFile, organizationId: "org-runtime" }, () => true)
  if (!backend.server.listening) await once(backend.server, "listening")
  const address = backend.server.address()
  if (address === null || typeof address === "string") throw new Error("backend fixture did not bind a TCP port")
  return { origin: `http://127.0.0.1:${String(address.port)}`, token, close: async () => {
    await backend.close()
    rmSync(directory, { recursive: true, force: true })
  } }
}

export const startUpstreamFixture = async () => {
  let oversizedAttempts = 0
  let activeStreams = 0
  const sockets = new Set()
  const binary = Buffer.from([0, 255, 37, 47, 128, 13, 10])
  const server = createServer((request, response) => {
    if (request.url === "/api/documents/customer%2F1/value%25raw?a=1&a=2") {
      response.writeHead(200, { "content-type": "application/octet-stream", etag: '"runtime-binary"',
        "content-disposition": 'attachment; filename="runtime.bin"' })
      response.end(binary); return
    }
    if (request.url === "/api/redirect") { response.writeHead(303, { location: "http://127.0.0.1:1/private" }); response.end(); return }
    if (request.url === "/api/unavailable") { request.socket.destroy(); return }
    if (request.url === "/api/rate") { response.writeHead(429, { "retry-after": "17" }); response.end("rate"); return }
    if (request.url === "/api/service") { response.writeHead(503); response.end("service"); return }
    if (request.url === "/api/slow") return
    if (request.url === "/api/stream") {
      activeStreams += 1
      let closed = false
      const finish = () => { if (!closed) { closed = true; activeStreams -= 1 } }
      request.once("close", finish)
      response.once("close", finish)
      response.writeHead(200, { "content-type": "application/octet-stream" })
      response.write(Buffer.alloc(32_768, 7))
      return
    }
    if (request.url === "/api/customers") oversizedAttempts += 1
    response.writeHead(200, { "content-type": "application/json" })
    response.end("{}")
  })
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  const port = await listen(server)
  return { origin: `http://127.0.0.1:${String(port)}`, binary, oversizedAttempts: () => oversizedAttempts,
    activeStreams: () => activeStreams, waitFor, close: () => closeHttpServer(server, sockets) }
}

export const abortAfterFirstChunk = ({ origin, path, headers }) => new Promise((resolveAbort, rejectAbort) => {
  const target = new URL(path, origin)
  const request = nodeRequest({ hostname: target.hostname, port: target.port, path: `${target.pathname}${target.search}`,
    headers, agent: false }, (response) => {
    response.once("data", () => { response.destroy(); resolveAbort() })
  })
  request.once("error", rejectAbort)
  request.end()
})
