import assert from "node:assert/strict"
import test from "node:test"

import { gated } from "../anaf/connection.test-support.ts"
import type { Transport } from "../../outbound/send.ts"
import { runShutdown } from "../../http/shutdown.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { DISPATCHER_LOCK, dispatchRig, type DispatchRig } from "./dispatch.test-support.ts"

/**
 * One executor at a time, proven on a real PostgreSQL server: the session lock
 * on the dispatcher's own connection, the epoch every write is fenced by, and
 * what happens to the ANAF call in flight when the lead is lost or the process
 * stops.
 */

const withRig = (label: string, use: (rig: DispatchRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await dispatchRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms) })

const lockHolders = async (rig: DispatchRig): Promise<number> => Number((await rig.sql(
  `SELECT count(*) AS holders FROM ${DISPATCHER_LOCK}`))[0]?.holders)

const epoch = async (rig: DispatchRig): Promise<number | undefined> => {
  const [row] = await rig.sql("SELECT epoch FROM efactura_dispatcher_epoch")
  return row === undefined ? undefined : Number(row.epoch)
}

/** Holds the upload at a gate; the call goes on even if it was aborted, so a late answer really reaches the old leader. */
const heldUpload = (rig: DispatchRig, keepGoingWhenAborted = false) => {
  const signals: Array<AbortSignal> = []
  const base: Transport = (url, init) => rig.fake.transport(url, keepGoingWhenAborted ? { ...init, signal: null } : init)
  const gate = gated(base, "/upload")
  const recording: Transport = (url, init) => {
    if (new URL(url).pathname.endsWith("/upload") && init.signal) signals.push(init.signal)
    return gate.transport(url, init)
  }
  return { transport: recording, hold: gate.hold, signals }
}

void test("two executors started together: one leads, the other waits, one upload", () => withRig("efl_together", async (rig) => {
  await rig.connect()
  const [first, second] = [rig.dispatcher(), rig.dispatcher()]
  await rig.until("a leader", () => Promise.resolve(first.epoch() !== undefined || second.epoch() !== undefined))
  await pause(300)
  assert.equal([first.epoch(), second.epoch()].filter((value) => value !== undefined).length, 1)
  assert.equal(await lockHolders(rig), 1)
  assert.equal(await epoch(rig), 1)
  const id = await rig.submitted(await rig.invoice("inv-1"))
  await rig.reaches(id, "processing")
  assert.equal(rig.calls("upload"), 1)
}))

void test("an executor started during the leader's upload does not lead and does not upload", () => withRig("efl_during", async (rig) => {
  await rig.connect()
  const upload = heldUpload(rig)
  const held = upload.hold()
  const leader = rig.dispatcher(upload.transport)
  const id = await rig.submitted(await rig.invoice("inv-1"))
  await held.reached
  const late = rig.dispatcher(upload.transport)
  await pause(300)
  assert.equal(late.epoch(), undefined)
  assert.equal(leader.epoch(), 1)
  held.release()
  await rig.reaches(id, "processing")
  await pause(200)
  assert.equal(rig.calls("upload"), 1)
  assert.equal(late.epoch(), undefined)
}))

void test("a leader whose connection dies during an upload writes nothing more; the next one recovers it as unknown",
  () => withRig("efl_conn_lost", async (rig) => {
    await rig.connect()
    const upload = heldUpload(rig, true)
    const held = upload.hold()
    const old = rig.dispatcher(upload.transport)
    const id = await rig.submitted(await rig.invoice("inv-1"))
    await held.reached
    assert.equal((await rig.row(id)).state, "uploading")
    const next = rig.dispatcher(upload.transport)
    await rig.sql(`SELECT pg_terminate_backend(pid) FROM ${DISPATCHER_LOCK}`)
    await rig.until("the new leader", () => Promise.resolve(next.epoch() === 2))
    await rig.reaches(id, "unknown")
    assert.equal(old.epoch(), undefined)
    assert.ok(upload.signals[0]?.aborted, "the old leader's upload was aborted")
    // ANAF still gets the upload and answers it with an index: nobody may write that answer any more.
    held.release()
    await rig.until("the late upload at ANAF", () => Promise.resolve(rig.calls("upload") === 1))
    await pause(500)
    const after = await rig.row(id)
    assert.deepEqual([after.state, after.upload_index], ["unknown", null])
    assert.deepEqual(await rig.attempts(id), ["validare:answered"], "the old leader logged nothing after it lost the lead")
    assert.deepEqual(await rig.audit(id), ["efactura_submission.queued", "efactura_submission.unknown"])
    assert.equal(await epoch(rig), 2)
  }))

void test("losing the maintenance barrier aborts the upload in flight; leading again recovers it as unknown",
  () => withRig("efl_barrier", async (rig) => {
    await rig.connect()
    const barrier = { held: true }
    const upload = heldUpload(rig)
    const held = upload.hold()
    const dispatcher = rig.dispatcher(upload.transport, () => barrier.held)
    const id = await rig.submitted(await rig.invoice("inv-1"))
    await held.reached
    barrier.held = false
    await rig.until("the abort", () => Promise.resolve(upload.signals[0]?.aborted === true))
    await rig.until("the lead given up", () => Promise.resolve(dispatcher.epoch() === undefined))
    assert.equal(await lockHolders(rig), 0)
    held.release()
    assert.equal((await rig.row(id)).state, "uploading", "nothing is written without the barrier")
    barrier.held = true
    await rig.reaches(id, "unknown")
    assert.equal(dispatcher.epoch(), 2)
    assert.equal(rig.calls("upload"), 0, "the aborted upload never reached ANAF")
  }))

void test("a shutdown during an upload stops the dispatcher first and finishes well within its deadline",
  () => withRig("efl_shutdown", async (rig) => {
    await rig.connect()
    const upload = heldUpload(rig)
    const held = upload.hold()
    const dispatcher = rig.dispatcher(upload.transport)
    const id = await rig.submitted(await rig.invoice("inv-1"))
    await held.reached
    const order: Array<string> = []
    let abandoned = 0
    const started = Date.now()
    const code = await runShutdown({
      stopWorkers: async () => { order.push("workers"); await dispatcher.stop() },
      drain: () => { order.push("drain"); return Promise.resolve() },
      destroyConnections: () => {},
      endQueries: () => { order.push("queries"); return Promise.resolve() },
      releaseBarrier: () => { order.push("barrier"); return Promise.resolve() },
      closePools: () => Promise.resolve(),
      report: (step, error) => { order.push(`failed:${step}:${String(error)}`) },
      abandon: () => { abandoned += 1 },
      escalateMs: 5_000,
      deadlineMs: 10_000,
    })
    assert.equal(code, 0)
    assert.equal(abandoned, 0)
    assert.ok(Date.now() - started < 10_000)
    assert.deepEqual(order, ["workers", "drain", "queries", "barrier"])
    assert.ok(upload.signals[0]?.aborted, "the upload in flight was aborted")
    assert.equal(await lockHolders(rig), 0, "the dispatcher's lock went with its connection")
    held.release()
    await pause(200)
    assert.equal((await rig.row(id)).state, "uploading", "left for the next start's recovery, which makes it unknown")
    assert.equal(rig.calls("upload"), 0)
  }))
