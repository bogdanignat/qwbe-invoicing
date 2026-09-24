import { execFileSync, spawn } from "node:child_process"
import { Buffer } from "node:buffer"
import { once } from "node:events"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer, request as nodeRequest } from "node:http"
import { createServer as createSecureServer } from "node:https"
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

/**
 * A request whose path reaches the socket exactly as written.
 *
 * `httpRequest` builds a `URL` to split origin from path, and that resolves
 * `..`, `.` and the encodings of a dot before anything is sent, so a traversal
 * attempt is normalized away by the test itself and never reaches the server
 * under test. Here the path is handed to `node:http` verbatim.
 */
export const rawHttpRequest = ({ origin, path, method = "GET", headers = {}, timeoutMs = 5_000 }) =>
  new Promise((resolveRequest, rejectRequest) => {
    const target = new URL(origin)
    const request = nodeRequest({ hostname: target.hostname, port: target.port, path, method, headers, agent: false },
      (response) => {
        const responseChunks = []
        response.on("data", (chunk) => responseChunks.push(chunk))
        response.once("end", () => resolveRequest({ status: response.statusCode ?? 0, headers: response.headers,
          body: Buffer.concat(responseChunks) }))
      })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`request exceeded ${String(timeoutMs)}ms`)))
    request.once("error", rejectRequest)
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

export const startFrontend = async (upstreamOrigin, { env = {} } = {}) => {
  const port = await reservePort()
  const origin = `http://127.0.0.1:${String(port)}`
  const child = spawn(process.execPath, ["--import", runtimeValidator, standaloneServer], {
    cwd: join(repositoryRoot, "frontend"),
    env: { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port),
      FRONTEND_ORIGIN: origin, INVOICING_API_URL: upstreamOrigin, ...env },
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

const sessionCookieValue = "a".repeat(43)
const issuedSessionCookie = `qwbe_session=${sessionCookieValue}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=2592000`
const clearSessionCookie = "qwbe_session=; Path=/api; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"

export const sessionCookies = { issued: issuedSessionCookie, clear: clearSessionCookie }

export const startUpstreamFixture = async () => {
  let oversizedAttempts = 0
  let activeStreams = 0
  const sockets = new Set()
  const requestedUrls = []
  const binary = Buffer.from([0, 255, 37, 47, 128, 13, 10])
  const server = createServer((request, response) => {
    requestedUrls.push(request.url)
    const cookies = {
      "/api/cookie-issued": [issuedSessionCookie],
      "/api/cookie-clear": [clearSessionCookie],
      "/api/cookie-foreign": ["theme=dark; Path=/"],
      "/api/cookie-tampered": [issuedSessionCookie.replace("Path=/api", "Path=/")],
      "/api/cookie-malformed": ["qwbe_session=short; Path=/api; HttpOnly; SameSite=Strict; Max-Age=60"],
      "/api/cookie-multiple": [issuedSessionCookie, issuedSessionCookie],
      "/api/cookie-issue-and-clear": [issuedSessionCookie, clearSessionCookie],
    }[request.url ?? ""]
    if (cookies !== undefined) {
      response.writeHead(200, { "content-type": "application/json", "set-cookie": cookies })
      response.end('{"authenticated":true}'); return
    }
    if (request.url === "/api/documents/customer%2F1/value%25raw?a=1&a=2") {
      response.writeHead(200, { "content-type": "application/octet-stream", etag: '"runtime-binary"',
        "content-disposition": 'attachment; filename="runtime.bin"' })
      response.end(binary); return
    }
    // The two document downloads as the fiscal API declares them: a PDF that is
    // rendered by a POST before it can be read, and an e-Factura XML that is a
    // plain read. Both answer with their own media type, a file name and a
    // validator, which is exactly what the proxy has to carry through untouched.
    if (request.url === "/api/invoices/inv-1/pdf") {
      if (request.method === "POST") { response.writeHead(200, { "content-type": "application/json" }); response.end("{}"); return }
      response.writeHead(200, { "content-type": "application/pdf", etag: '"invoice-pdf"',
        "content-disposition": 'attachment; filename="factura-FCT-12.pdf"' })
      response.end(binary); return
    }
    if (request.url === "/api/invoices/inv-1/efactura.xml" || request.url === "/api/corrections/cor-1/efactura.xml") {
      response.writeHead(200, { "content-type": "application/xml", etag: '"document-xml"',
        "content-disposition": 'attachment; filename="document.xml"' })
      response.end("<Invoice/>"); return
    }
    if (request.url === "/api/invoices/expired/pdf") {
      response.writeHead(401, { "content-type": "application/json" })
      response.end('{"error":"unauthorized"}'); return
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
    activeStreams: () => activeStreams, requestedUrls: () => [...requestedUrls], waitFor,
    close: () => closeHttpServer(server, sockets) }
}

/**
 * The `openssl` this probe needs, refused early and by name when it is missing.
 *
 * Without this check the first certificate command fails as `spawnSync openssl
 * ENOENT` from inside a TLS assertion, which reads as a broken proxy rather than
 * a host that cannot generate the material. `-addext` is used below and arrived
 * in OpenSSL 1.1.1, so an older binary is reported as plainly as an absent one.
 */
const requireOpenssl = () => {
  let version
  try {
    version = execFileSync("openssl", ["version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  } catch (cause) {
    throw new Error("The TLS probe needs the `openssl` binary on PATH to generate throwaway "
      + "certificates, and it could not be run", { cause })
  }
  const release = /^(?:OpenSSL|LibreSSL)\s+(\d+)\.(\d+)\.(\d+)/u.exec(version)
  if (release === null) throw new Error(`The TLS probe could not read an OpenSSL version from: ${version}`)
  const [major, minor, patch] = release.slice(1).map(Number)
  const supportsAddext = major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 1)))
  if (!supportsAddext) {
    throw new Error(`The TLS probe needs OpenSSL >= 1.1.1 for \`-addext\`, and this host reports: ${version}`)
  }
  return version
}

/**
 * A throwaway certificate authority and one leaf certificate for `commonName`.
 *
 * Generated per run under a temporary directory: nothing is checked in, and the
 * CA is trusted only by the child process that receives `NODE_EXTRA_CA_CERTS`.
 * `subjectAltName` is given in OpenSSL's own syntax so a certificate can name an
 * address (`IP:127.0.0.1`) as well as a hostname, which is what an upstream
 * addressed by a literal address must present.
 */
export const createTlsMaterial = (commonName, subjectAltName = `DNS:${commonName}`) => {
  requireOpenssl()
  const directory = mkdtempSync(join(tmpdir(), "qwbe-runtime-tls-"))
  const file = (name) => join(directory, name)
  const openssl = (...args) => execFileSync("openssl", args, { stdio: ["ignore", "ignore", "pipe"] })
  openssl("req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", file("ca.key"), "-out", file("ca.crt"),
    "-days", "1", "-subj", "/CN=qwbe-runtime-ca", "-addext", "basicConstraints=critical,CA:TRUE")
  openssl("req", "-newkey", "rsa:2048", "-nodes", "-keyout", file("leaf.key"), "-out", file("leaf.csr"),
    "-subj", `/CN=${commonName}`)
  writeFileSync(file("leaf.ext"), `subjectAltName=${subjectAltName}\nbasicConstraints=critical,CA:FALSE\n`)
  openssl("x509", "-req", "-in", file("leaf.csr"), "-CA", file("ca.crt"), "-CAkey", file("ca.key"), "-CAcreateserial",
    "-out", file("leaf.crt"), "-days", "1", "-extfile", file("leaf.ext"))
  return {
    caPath: file("ca.crt"),
    key: readFileSync(file("leaf.key")),
    certificate: readFileSync(file("leaf.crt")),
    close: () => rmSync(directory, { recursive: true, force: true }),
  }
}

/**
 * An HTTPS upstream bound to the loopback address, addressed by `host`.
 *
 * `host` only decides the origin the frontend is configured with: the socket is
 * always the loopback one, so `127.0.0.1` exercises an upstream addressed by a
 * literal address and `localhost` one addressed by a name.
 */
export const startTlsUpstreamFixture = async ({ key, certificate }, { host = "localhost" } = {}) => {
  const sockets = new Set()
  const serverNames = []
  const server = createSecureServer({ key, cert: certificate }, (request, response) => {
    response.writeHead(200, { "content-type": "application/json" })
    response.end('{"tls":true}')
  })
  // The name the client actually asked for in the TLS handshake, not the one the
  // HTTP Host header carries afterwards.
  server.on("secureConnection", (socket) => { serverNames.push(socket.servername) })
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)) })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const address = server.address()
  if (address === null || typeof address === "string") throw new Error("tls fixture did not bind a TCP port")
  return { port: address.port, origin: `https://${host}:${String(address.port)}`,
    serverNames: () => [...serverNames], close: () => closeHttpServer(server, sockets) }
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
