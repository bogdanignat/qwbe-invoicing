import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Effect } from "effect"

import { connectionHost } from "../efactura/anaf/connection-host.ts"
import { ORG } from "../efactura/anaf/connection.test-support.ts"
import { startFakeAnaf } from "../efactura/anaf/fake-anaf.test-support.ts"
import { connectionWrite, dispatchRig } from "../efactura/dispatch/dispatch.test-support.ts"
import { startDispatcher } from "../efactura/dispatch/dispatcher.ts"
import { emptyFixture, withMigrated, type TestFixture } from "../storage/postgres-rig.test-support.ts"
import { executeBackup, executeRestore } from "./postgres-backup.ts"

/**
 * A restore never lets a submission leave on its own: what the backup shows
 * queued, validating or uploading may have reached ANAF since. The
 * transformation runs inside the restore's own `psql --single-transaction`,
 * so it lands with the data or nothing lands.
 */

const count = async (fixture: TestFixture, sql: string, values: ReadonlyArray<string> = []): Promise<number> =>
  Number((await fixture.pool.query<{ readonly n: string }>(sql, [...values])).rows[0]?.n)

interface Queued { readonly invoiceId: string; readonly id: string }

/** A backup of a database with `count` invoices, each with a `queued` submission; `prepare` may change rows first. */
const backupWithQueued = async (root: string, count = 1,
  prepare: (fixture: TestFixture, queued: ReadonlyArray<Queued>) => Promise<void> = async () => {}) =>
  withMigrated("efr_source", async (source) => {
    const rig = await dispatchRig(source)
    const queued: Array<Queued> = []
    try {
      await rig.connect()
      for (let index = 0; index < count; index += 1) {
        const invoiceId = await rig.invoice(`inv-${String(index)}`)
        queued.push({ invoiceId, id: await rig.submitted(invoiceId) })
      }
    } finally {
      await rig.close()
    }
    await prepare(source, queued)
    const archive = join(root, "backup.tar.gz")
    const report = await executeBackup({ pool: source.pool, settings: source.settings, dataDirectory: source.dataDirectory, organizationId: ORG }, archive)
    assert.equal(report.failed, 0)
    return { queued, archive, settings: rig.settings }
  })

void test("a restored queued submission is unknown; reactivating e-Factura and reconnecting uploads nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-efr-"))
  const target = await emptyFixture("efr_target")
  try {
    const { archive, queued, settings } = await backupWithQueued(root)
    const { invoiceId, id } = queued[0] ?? assert.fail("one queued submission")
    // `restore` reads no QWBE_PLUGINS at all: the transformation is part of the SQL it commits.
    const restored = await executeRestore({ pool: target.pool, settings: target.settings, dataDirectory: target.dataDirectory, organizationId: ORG }, archive)
    assert.equal(restored.failed, 0)
    const [row] = (await target.pool.query<{ readonly state: string; readonly errors: string }>(
      "SELECT state, errors FROM efactura_submissions WHERE id=$1", [id])).rows
    assert.deepEqual([row?.state, JSON.parse(row?.errors ?? "null")], ["unknown", ["restaurat din backup"]])
    assert.equal((await target.pool.query<{ readonly e_factura_status: string }>(
      "SELECT e_factura_status FROM issued_invoices WHERE id=$1", [invoiceId])).rows[0]?.e_factura_status, "unknown")
    const audit = (await target.pool.query("SELECT id, actor_id, reason FROM audit_events WHERE action='efactura_submission.restored_unknown'"))
      .rows
    assert.deepEqual(audit, [{ id: `efactura-restore:${id}`, actor_id: "efactura:restore", reason: "restaurat din backup" }])
    assert.equal(await count(target, "SELECT count(*) AS n FROM efactura_oauth_attempts"), 0)
    assert.equal(await count(target, "SELECT count(*) AS n FROM efactura_connections"), 0)

    // The plugin comes back on, the connection is made again: still nothing leaves.
    const fake = await startFakeAnaf()
    const dispatcher = startDispatcher({ settings: target.settings, anaf: settings, transport: fake.transport, barrierHeld: () => true,
      idleMs: 25, retryMs: 50, keepaliveMs: 50, now: () => new Date(Date.now() + 3_600_000) })
    try {
      await Effect.runPromise(connectionHost(target.pool, settings, fake.transport).store.transaction((transaction) =>
        transaction.saveConnection(ORG, connectionWrite(new Date()))))
      const deadline = Date.now() + 5_000
      while (dispatcher.epoch() === undefined && Date.now() < deadline) await new Promise((resolve) => { setTimeout(resolve, 25) })
      assert.equal(dispatcher.epoch(), 1)
      await new Promise((resolve) => { setTimeout(resolve, 500) })
      assert.deepEqual(fake.calls.map((call) => call.operation), [], "no validation, no upload")
      assert.equal((await target.pool.query<{ readonly state: string }>(
        "SELECT state FROM efactura_submissions WHERE id=$1", [id])).rows[0]?.state, "unknown")
    } finally {
      await dispatcher.stop()
      await fake.close()
    }
  } finally {
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a transformation that fails leaves the target as it was: no table, no artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-efr-"))
  const target = await emptyFixture("efr_rollback")
  try {
    // The restore's audit row already exists, so its INSERT fails after the whole dump went in.
    const { archive } = await backupWithQueued(root, 1, async (source, [queued]) => {
      await source.pool.query(`INSERT INTO audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id)
        VALUES($1,'org-1','someone','2026-10-19T00:00:00.000Z','efactura_submission.restored_unknown','efactura_submission',$2)`,
      [`efactura-restore:${String(queued?.id)}`, queued?.id])
    })
    await assert.rejects(executeRestore({ pool: target.pool, settings: target.settings, dataDirectory: target.dataDirectory, organizationId: ORG }, archive),
      /psql failed .*duplicate key value violates unique constraint "audit_events_pkey"/su)
    assert.equal(await count(target, "SELECT count(*) AS n FROM pg_tables WHERE schemaname='public'"), 0, "the dump rolled back with it")
    assert.deepEqual(readdirSync(target.dataDirectory), [])
  } finally {
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})

void test("a restore makes validating and uploading unknown, and leaves processing and a pending archive as they were", async () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-efr-"))
  const target = await emptyFixture("efr_states")
  try {
    const changes = ["state='uploading'", "state='validating'", "state='processing', upload_index='5000000003'",
      "state='accepted', upload_index='5000000004', download_id='3000000004', archive_state='pending'"]
    const { archive, queued } = await backupWithQueued(root, changes.length, async (source, rows) => {
      for (const [index, change] of changes.entries()) {
        await source.pool.query(`UPDATE efactura_submissions SET ${change} WHERE id=$1`, [rows[index]?.id])
      }
    })
    assert.equal((await executeRestore({ pool: target.pool, settings: target.settings, dataDirectory: target.dataDirectory, organizationId: ORG }, archive)).failed, 0)
    const rows = (await target.pool.query<{ readonly id: string; readonly state: string; readonly archive_state: string;
      readonly upload_index: string | null }>("SELECT id, state, archive_state, upload_index FROM efactura_submissions")).rows
    assert.deepEqual(queued.map(({ id }) => rows.find((row) => row.id === id)).map((row) => [row?.state, row?.archive_state, row?.upload_index]), [
      ["unknown", "none", null], ["unknown", "none", null], ["processing", "none", "5000000003"], ["accepted", "pending", "5000000004"],
    ])
    const audited = (await target.pool.query<{ readonly target_id: string }>(
      "SELECT target_id FROM audit_events WHERE action='efactura_submission.restored_unknown' ORDER BY target_id")).rows
    assert.deepEqual(audited.map((row) => row.target_id), [queued[0]?.id, queued[1]?.id].sort())
  } finally {
    await target.close()
    rmSync(root, { recursive: true, force: true })
  }
})
