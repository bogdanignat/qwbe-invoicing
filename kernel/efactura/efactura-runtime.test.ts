import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createServer } from "node:net"
import test from "node:test"

import type { Pool } from "pg"

import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { anafSettingsFor } from "./anaf/connection.test-support.ts"
import { DISPATCHER_LOCK } from "./dispatch/dispatch.test-support.ts"
import { startEFacturaRuntime, type EFacturaRuntimeOptions } from "./efactura-runtime.ts"

/**
 * The e-Factura side of `serve`: the environment guard runs whatever
 * `QWBE_PLUGINS` says and stops `serve` when it refuses; the dispatcher runs
 * only with the plugin on, and only once the application is ready.
 */

const storedIn = async (pool: Pool, environment: "test" | "prod") => {
  await pool.query(`INSERT INTO efactura_submissions(id,organization_id,environment,document_kind,document_id,standard,cif,xml,xml_sha256,
    xml_size,state,next_attempt_at,created_by,created_at,updated_at) VALUES('s-1','org-1',$1,'invoice','inv-1','UBL','12345674',
    '\\x3c782f3e'::bytea,encode(sha256('\\x3c782f3e'::bytea),'hex'),4,'unknown','2026-10-19T00:00:00.000Z','user-1',
    '2026-10-19T00:00:00.000Z','2026-10-19T00:00:00.000Z')`, [environment])
}

const leaders = async (pool: Pool) => Number((await pool.query<{ readonly n: string }>(
  `SELECT count(*) AS n FROM ${DISPATCHER_LOCK}`)).rows[0]?.n)

/** A port nothing listens on: taken and given back before the child starts. */
const freePort = () => new Promise<number>((resolve) => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const address = server.address()
    server.close(() => { resolve(typeof address === "object" && address !== null ? address.port : 0) })
  })
})

const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

const options = (pool: Pool, settings: EFacturaRuntimeOptions["settings"], overrides: Partial<EFacturaRuntimeOptions> = {}) => {
  const refusals: Array<string> = []
  return {
    refusals,
    options: { pool, settings, anaf: anafSettingsFor(), pluginOn: true, ready: () => Promise.resolve(true), barrierHeld: () => true,
      onRefused: (message: string) => { refusals.push(message) }, readyPollMs: 20, idleMs: 25, retryMs: 50, keepaliveMs: 50,
      transport: () => Promise.reject(new Error("no ANAF in this test")), ...overrides } satisfies EFacturaRuntimeOptions,
  }
}

void test("with the plugin off the guard still refuses another environment, and no dispatcher starts", () =>
  withMigrated("efrt_guard_off", async (fixture) => {
    await storedIn(fixture.pool, "prod")
    const { refusals, options: off } = options(fixture.pool, fixture.settings, { pluginOn: false })
    const runtime = startEFacturaRuntime(off)
    try {
      while (refusals.length === 0) await pause(20)
      assert.match(refusals[0] ?? "", /ANAF_ENVIRONMENT is test, but e-Factura submissions exist for prod/u)
      assert.equal(runtime.environmentChecked(), false, "a refused guard never lets traffic in")
      await pause(200)
      assert.equal(await leaders(fixture.pool), 0)
    } finally {
      await runtime.stop()
    }
  }))

void test("the dispatcher waits for readiness, runs only with the plugin on, and its stop gives the lock back", () =>
  withMigrated("efrt_dispatcher", async (fixture) => {
    await storedIn(fixture.pool, "test")
    const off = startEFacturaRuntime(options(fixture.pool, fixture.settings, { pluginOn: false }).options)
    await pause(300)
    assert.equal(await leaders(fixture.pool), 0, "plugin off: no dispatcher")
    await off.stop()

    const ready = { now: false }
    const { refusals, options: on } = options(fixture.pool, fixture.settings, { ready: () => Promise.resolve(ready.now) })
    const runtime = startEFacturaRuntime(on)
    try {
      await pause(300)
      assert.equal(await leaders(fixture.pool), 0, "not before readiness")
      assert.equal(runtime.environmentChecked(), false, "no traffic before the guard could run")
      ready.now = true
      const deadline = Date.now() + 5_000
      while (await leaders(fixture.pool) === 0 && Date.now() < deadline) await pause(25)
      assert.equal(await leaders(fixture.pool), 1)
      assert.equal(runtime.environmentChecked(), true, "the guard passed before the dispatcher started")
      assert.deepEqual(refusals, [])
    } finally {
      await runtime.stop()
    }
    assert.equal(await leaders(fixture.pool), 0)
  }))

void test("serve exits 1 when ANAF_ENVIRONMENT is not the stored submissions', even with e-Factura off", () =>
  withMigrated("efrt_serve_refuses", async (fixture) => {
    await storedIn(fixture.pool, "prod")
    const port = await freePort()
    const child = spawn("node", ["bin/qwbe-invoicing.ts", "serve"], {
      cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"],
      env: fixture.childEnv({ HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "development", QWBE_PLUGINS: "", ANAF_ENVIRONMENT: "test" }),
    })
    let output = ""
    child.stdout.on("data", (chunk: Buffer) => { output += chunk.toString("utf8") })
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString("utf8") })
    const exited = new Promise<number | null>((resolve) => { child.once("exit", (code) => { resolve(code) }) })
    const timer = setTimeout(() => { child.kill("SIGKILL") }, 30_000)
    // While it lives, the refused process never says it is ready: the guard comes before any traffic.
    const answers = new Set<number>()
    const watched = (async () => {
      while (child.exitCode === null) {
        await fetch(`http://127.0.0.1:${String(port)}/health/ready`).then((reply) => { answers.add(reply.status) }, () => undefined)
        await pause(10)
      }
    })()
    try {
      assert.equal(await exited, 1, output)
      await watched
      assert.equal(answers.has(200), false, `answers: ${[...answers].join(",")}`)
      assert.match(output, /serve refused to start: ANAF_ENVIRONMENT is test, but e-Factura submissions exist for prod/u)
    } finally {
      clearTimeout(timer)
      if (child.exitCode === null) child.kill("SIGKILL")
    }
  }))
