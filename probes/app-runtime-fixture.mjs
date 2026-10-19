import { Buffer } from "node:buffer"
import { spawn, spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, writeFileSync } from "node:fs"
import { request } from "node:http"
import { createServer } from "node:net"
import { dirname, join } from "node:path"
import { clearTimeout, setTimeout } from "node:timers"
import { fileURLToPath } from "node:url"

import { emptyFixture } from "../kernel/storage/postgres-rig.test-support.ts"

/**
 * The shipped kernel, started the way the image starts it: `bin/qwbe-invoicing.ts`
 * as a child process, `migrate --apply` first and then `serve`, on a fresh
 * database of the verifier's PostgreSQL 16 rig and with the real Vite build as
 * `QWBE_UI_DIR`. Nothing is called in process: what this sees is what a
 * browser behind the TLS proxy would see.
 *
 * Every database, directory and process here is created by this file and given
 * back by `close`: the token file lives in the fixture's data directory, which the
 * rig removes with its database; the child is the only process ever signalled.
 * Addresses are 127.0.0.1 on an ephemeral port.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
export const uiDirectory = join(root, "frontend", "dist")
const bootMillis = 20_000

const freePort = () => new Promise((resolve, reject) => {
  const server = createServer()
  server.once("error", reject)
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address()
    server.close(() => { resolve(port) })
  })
})

/** One HTTP exchange with exactly the headers given: `fetch` would not let the probe choose Host. */
export const exchange = (port, { method = "GET", path = "/", headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const payload = body === undefined ? undefined : Buffer.from(typeof body === "string" ? body : JSON.stringify(body))
  const outgoing = request({ host: "127.0.0.1", port, method, path, setHost: false, agent: false,
    headers: { ...headers, ...(payload === undefined ? {} : { "content-length": String(payload.length) }) } }, (response) => {
    const chunks = []
    response.on("data", (chunk) => chunks.push(chunk))
    response.on("end", () => {
      const raw = Buffer.concat(chunks)
      const type = response.headers["content-type"] ?? ""
      resolve({ status: response.statusCode, headers: response.headers, raw,
        body: type.includes("json") ? JSON.parse(raw.toString("utf8")) : raw.toString("utf8") })
    })
  })
  outgoing.setTimeout(15_000, () => outgoing.destroy(new Error(`${method} ${path} timed out`)))
  outgoing.once("error", reject)
  outgoing.end(payload)
})

const sleep = (millis) => new Promise((resolve) => { setTimeout(resolve, millis) })

/** SIGTERM, then SIGKILL if the child is still there after `graceMillis`; the timer never outlives the child. */
const stop = async (child, exited, graceMillis = 15_000) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  const timer = setTimeout(() => child.kill("SIGKILL"), graceMillis)
  await exited
  clearTimeout(timer)
}

const readyWithin = async (port, child, output) => {
  const deadline = Date.now() + bootMillis
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`serve exited with ${String(child.exitCode)}: ${output()}`)
    try {
      // The Docker healthcheck's request: the internal address as Host, which /health/* accepts.
      if ((await exchange(port, { path: "/health/ready", headers: { host: `127.0.0.1:${String(port)}` } })).status === 200) return
    } catch {
      // Not listening yet.
    }
    await sleep(200)
  }
  throw new Error(`serve was not ready within ${String(bootMillis)}ms: ${output()}`)
}

/**
 * A migrated database, a token file and a running `serve`. `environment` adds to
 * (or overrides) what the child gets, e.g. NODE_ENV and PUBLIC_ORIGIN.
 */
export const startKernel = async (label, environment = {}) => {
  if (!existsSync(join(uiDirectory, "index.html"))) throw new Error("frontend/dist is missing: run `pnpm build:frontend` first")
  const fixture = await emptyFixture(label)
  const token = randomBytes(32).toString("base64url")
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  let child
  try {
    const migrate = spawnSync("node", ["bin/qwbe-invoicing.ts", "migrate", "--apply", "--json"],
      { cwd: root, env: fixture.childEnv(), encoding: "utf8", timeout: 60_000 })
    if (migrate.status !== 0) throw new Error(`migrate exited with ${String(migrate.status)}: ${migrate.stderr}`)
    const port = await freePort()
    child = spawn("node", ["bin/qwbe-invoicing.ts", "serve"], {
      cwd: root,
      env: fixture.childEnv({ HOST: "127.0.0.1", PORT: String(port), AUTH_TOKEN_FILE: tokenFile,
        ORGANIZATION_ID: "org-runtime", QWBE_UI_DIR: uiDirectory, QWBE_BEARER_API: "off", ...environment }),
      stdio: ["ignore", "pipe", "pipe"],
    })
    const exited = new Promise((resolve) => { child.once("exit", resolve) })
    let captured = ""
    child.stdout.on("data", (chunk) => { captured += chunk.toString("utf8") })
    child.stderr.on("data", (chunk) => { captured += chunk.toString("utf8") })
    const output = () => captured
    await readyWithin(port, child, output)
    return {
      port, token, output,
      close: async () => {
        await stop(child, exited)
        await fixture.close()
      },
    }
  } catch (error) {
    if (child !== undefined && child.exitCode === null) child.kill("SIGKILL")
    await fixture.close()
    throw error
  }
}
