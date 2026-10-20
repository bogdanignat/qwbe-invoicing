import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { AnafEnvironmentMismatch, assertAnafEnvironment } from "./environment-guard.ts"

const NOW = "2026-10-19T10:00:00.000Z"
const XML = Buffer.from("<Invoice/>")
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")

interface Submission {
  readonly id: string
  readonly environment?: string
  readonly documentId?: string
  readonly state?: string
  readonly uploadIndex?: string
  readonly downloadId?: string
  readonly archive?: string
  readonly superseded?: boolean
  readonly xmlSha256?: string
  readonly buyerIsIndividual?: boolean | null
}

const submission = (row: Submission): readonly [string, ReadonlyArray<unknown>] => [
  `INSERT INTO efactura_submissions(id,organization_id,environment,document_kind,document_id,standard,cif,buyer_is_individual,xml,xml_sha256,
     xml_size,state,upload_index,download_id,archive_state,superseded,next_attempt_at,created_by,created_at,updated_at)
   VALUES($1,'org-1',$2,'invoice',$3,'UBL','12345674',$13,$4,$5,$6,$7,$8,$9,$10,$11,$12,'user-1',$12,$12)`,
  [row.id, row.environment ?? "test", row.documentId ?? `doc-${row.id}`, XML, row.xmlSha256 ?? sha256(XML), XML.byteLength, row.state ?? "queued",
    row.uploadIndex ?? null, row.downloadId ?? null, row.archive ?? "none", row.superseded ?? false, NOW,
    row.buyerIsIndividual === undefined ? false : row.buyerIsIndividual],
]

void test("one live submission per document: a rejected one makes room, an unknown one only once superseded", async () => {
  await withMigrated("efactura_current", async ({ sql }) => {
    await sql.query(...submission({ id: "s-1", documentId: "inv-1" }))
    const duplicate = await sql.rejects(...submission({ id: "s-2", documentId: "inv-1" }))
    assert.deepEqual([duplicate.code, duplicate.constraint], ["23505", "efactura_submissions_current"])
    await sql.query(...submission({ id: "s-3", documentId: "inv-2", state: "rejected", uploadIndex: "11", downloadId: "21", archive: "pending" }))
    await sql.query(...submission({ id: "s-4", documentId: "inv-2" }))
    await sql.query(...submission({ id: "s-5", documentId: "inv-3", state: "unknown" }))
    assert.equal((await sql.rejects(...submission({ id: "s-6", documentId: "inv-3" }))).constraint, "efactura_submissions_current")
    await sql.query("UPDATE efactura_submissions SET superseded=true WHERE id='s-5'")
    await sql.query(...submission({ id: "s-6", documentId: "inv-3" }))
    const index = await sql.rejects(...submission({ id: "s-7", state: "processing", uploadIndex: "11" }))
    assert.deepEqual([index.code, index.constraint], ["23505", "efactura_submissions_upload_index"])
  })
})

void test("every submission says whether its buyer is a private person: no default, no NULL", async () => {
  await withMigrated("efactura_buyer", async ({ sql }) => {
    assert.equal((await sql.rejects(...submission({ id: "a", buyerIsIndividual: null }))).code, "23502")
    const withoutFlag = `INSERT INTO efactura_submissions(id,organization_id,environment,document_kind,document_id,standard,cif,xml,xml_sha256,
      xml_size,state,next_attempt_at,created_by,created_at,updated_at) VALUES('b','org-1','test','invoice','doc-b','UBL','12345674',$1,$2,$3,
      'queued',$4,'user-1',$4,$4)`
    assert.equal((await sql.rejects(withoutFlag, [XML, sha256(XML), XML.byteLength, NOW])).code, "23502", "no default to fall back on")
    await sql.query(...submission({ id: "c", buyerIsIndividual: true }))
    assert.deepEqual(await sql.query("SELECT buyer_is_individual FROM efactura_submissions WHERE id='c'"), [{ buyer_is_individual: true }])
  })
})

void test("the state decides the upload index, the download id, the archive and who may be superseded", async () => {
  await withMigrated("efactura_states", async ({ sql }) => {
    const refusedBy = async (row: Submission) => (await sql.rejects(...submission(row))).constraint
    assert.equal(await refusedBy({ id: "a", state: "processing" }), "efactura_submissions_upload_index_by_state")
    assert.equal(await refusedBy({ id: "b", uploadIndex: "1" }), "efactura_submissions_upload_index_by_state")
    assert.equal(await refusedBy({ id: "c", state: "unknown", uploadIndex: "1" }), "efactura_submissions_upload_index_by_state")
    assert.equal(await refusedBy({ id: "d", state: "accepted", uploadIndex: "1", archive: "pending" }), "efactura_submissions_download_id_by_state")
    assert.equal(await refusedBy({ id: "e", state: "accepted", uploadIndex: "1", downloadId: "2" }), "efactura_submissions_archive_by_state")
    assert.equal(await refusedBy({ id: "f", state: "sent" }), "efactura_submissions_state_valid")
    assert.equal(await refusedBy({ id: "g", superseded: true }), "efactura_submissions_superseded_only_unknown")
    assert.equal(await refusedBy({ id: "h", state: "accepted", uploadIndex: "1", downloadId: "2", archive: "pending", superseded: true }),
      "efactura_submissions_superseded_only_unknown")
    await sql.query(...submission({ id: "i", state: "refused", uploadIndex: "3" }))
  })
})

void test("a stored digest is the digest of the stored bytes: the XML and the ANAF archive", async () => {
  await withMigrated("efactura_digests", async ({ sql }) => {
    for (const xmlSha256 of [sha256(Buffer.from("<Other/>")), sha256(XML).toUpperCase(), "a".repeat(64)]) {
      assert.equal((await sql.rejects(...submission({ id: "x", xmlSha256 }))).constraint, "efactura_submissions_xml_sha256_matches", xmlSha256)
    }
    await sql.query(...submission({ id: "s-1", state: "accepted", uploadIndex: "1", downloadId: "2", archive: "pending" }))
    const zip = Buffer.from("PK\x03\x04 archive")
    const response = `INSERT INTO efactura_responses(submission_id,organization_id,download_id,archive,sha256,size,stored_at)
      VALUES('s-1','org-1','2',$1,$2,$3,$4)`
    assert.equal((await sql.rejects(response, [zip, sha256(XML), zip.byteLength, NOW])).constraint, "efactura_responses_sha256_matches")
    await sql.query(response, [zip, sha256(zip), zip.byteLength, NOW])
  })
})

void test("the sent XML never changes and nothing of the history is deleted or rewritten", async () => {
  await withMigrated("efactura_history", async ({ sql }) => {
    await sql.query(...submission({ id: "old", state: "unknown" }))
    await sql.query(...submission({ id: "new" }))
    await sql.query("UPDATE efactura_submissions SET state='validating',updated_at=$1 WHERE id='new'", [NOW])
    const refusal = async (statement: string) => (await sql.rejects(statement)).message
    assert.equal(await refusal("UPDATE efactura_submissions SET xml='\\x00'::bytea WHERE id='new'"), "e-Factura submission content is immutable")
    assert.equal(await refusal("UPDATE efactura_submissions SET cif='99' WHERE id='new'"), "e-Factura submission content is immutable")
    assert.equal(await refusal("UPDATE efactura_submissions SET buyer_is_individual=true WHERE id='new'"),
      "e-Factura submission content is immutable", "the route ANAF gets is fixed with the XML")
    assert.equal(await refusal("DELETE FROM efactura_submissions WHERE id='new'"), "e-Factura submissions are kept")
    await sql.query(`INSERT INTO efactura_resubmissions(previous_id,next_id,organization_id,actor_id,created_at,duplicate_risk_confirmed)
      VALUES('old','new','org-1','user-1',$1,true)`, [NOW])
    assert.equal(await refusal("UPDATE efactura_resubmissions SET actor_id='x'"), "e-Factura resubmissions are append-only")
    assert.equal(await refusal("DELETE FROM efactura_resubmissions"), "e-Factura resubmissions are append-only")
    await sql.query(`INSERT INTO efactura_submission_attempts(id,submission_id,organization_id,operation,outcome,http_status,duration_ms,started_at)
      VALUES('a-1','new','org-1','upload','ambiguous',NULL,30000,$1)`, [NOW])
    assert.equal((await sql.rejects(`INSERT INTO efactura_submission_attempts(id,submission_id,organization_id,operation,outcome,http_status,duration_ms,started_at)
      VALUES('a-2','new','org-1','upload','answered',NULL,10,$1)`, [NOW])).constraint, "efactura_submission_attempts_status_when_answered")
    assert.equal(await refusal("UPDATE efactura_submission_attempts SET outcome='answered'"), "e-Factura call log is append-only")
    assert.equal(await refusal("DELETE FROM efactura_submission_attempts"), "e-Factura call log is append-only")
  })
})

void test("the budgets cannot pass ANAF's limits even if the reservation code were wrong", async () => {
  await withMigrated("efactura_budgets", async ({ sql }) => {
    const budget = "INSERT INTO efactura_message_budgets(organization_id,operation,message_id,day,used) VALUES('org-1',$1,$2,'2026-10-19',$3)"
    await sql.query(budget, ["stareMesaj", "1", 90])
    await sql.query(budget, ["descarcare", "1", 9])
    assert.equal((await sql.rejects(budget, ["stareMesaj", "2", 91])).constraint, "efactura_message_budgets_used_within_limit")
    assert.equal((await sql.rejects(budget, ["descarcare", "2", 10])).constraint, "efactura_message_budgets_used_within_limit")
    const rate = "INSERT INTO efactura_rate_limits(organization_id,minute,used,paused_until) VALUES($1,'2026-10-19T10:15',$2,$3)"
    await sql.query(rate, ["org-1", 900, NOW])
    assert.equal((await sql.rejects(rate, ["org-2", 901, NOW])).constraint, "efactura_rate_limits_used_within_limit")
  })
})

void test("a connection holds tokens only while connected, and an identity unless disconnected", async () => {
  await withMigrated("efactura_connection", async ({ sql }) => {
    const connection = `INSERT INTO efactura_connections(organization_id,environment,status,generation,revision,access_token_ciphertext,
      refresh_token_ciphertext,access_expires_at,refresh_expires_at,verified_cif,connected_by,connected_at,updated_by,updated_at)
      VALUES($1,'test',$2,0,0,$3,$3,$4,$5,$6,$7,$8,'user-1','2026-10-19T10:00:00.000Z')`
    const connected = ["v1.a.b.c", NOW, NOW, "12345674", "user-1", NOW]
    await sql.query(connection, ["org-1", "connected", ...connected])
    await sql.query(connection, ["org-2", "disconnected", null, null, null, null, null, null])
    await sql.query(connection, ["org-3", "needs_reconnect", null, null, NOW, "12345674", "user-1", NOW])
    assert.equal((await sql.rejects(connection, ["org-4", "disconnected", "v1.a.b.c", NOW, null, null, null, null])).constraint,
      "efactura_connections_tokens_only_connected")
    assert.equal((await sql.rejects(connection, ["org-4", "connected", null, null, NOW, "12345674", "user-1", NOW])).constraint,
      "efactura_connections_tokens_only_connected")
    assert.equal((await sql.rejects(connection, ["org-4", "needs_reconnect", null, null, null, null, null, null])).constraint,
      "efactura_connections_identity_unless_disconnected")
    const attempt = `INSERT INTO efactura_oauth_attempts(organization_id,nonce_sha256,generation,created_by,created_at,expires_at)
      VALUES($1,$2,0,'user-1','2026-10-19T10:00:00.000Z','2026-10-19T10:10:00.000Z')`
    await sql.query(attempt, ["org-1", "b".repeat(64)])
    assert.equal((await sql.rejects(attempt, ["org-1", "c".repeat(64)])).code, "23505", "one current attempt per organization")
    assert.equal((await sql.rejects(attempt, ["org-2", "B".repeat(64)])).constraint, "efactura_oauth_attempts_nonce_shape")
    assert.equal((await sql.rejects(attempt, ["org-9", "d".repeat(64)])).code, "23503", "an attempt belongs to a connection row")
  })
})

void test("serve's environment guard: submissions of another environment refuse it, none or the same let it pass", async () => {
  await withMigrated("efactura_guard", async ({ pool, sql }) => {
    await assertAnafEnvironment(pool, "test")
    await assertAnafEnvironment(pool, "prod")
    await sql.query(...submission({ id: "t-1" }))
    await assertAnafEnvironment(pool, "test")
    await assert.rejects(assertAnafEnvironment(pool, "prod"), (error: Error) =>
      error instanceof AnafEnvironmentMismatch && /ANAF_ENVIRONMENT is prod, but e-Factura submissions exist for test/u.test(error.message))
    await sql.query(...submission({ id: "p-1", environment: "prod" }))
    await assert.rejects(assertAnafEnvironment(pool, "test"), /submissions exist for prod/u)
  })
})
