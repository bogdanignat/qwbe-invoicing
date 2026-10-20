import assert from "node:assert/strict"
import test from "node:test"

import {
  ARCHIVE_STATES, CALL_OUTCOMES, FISCAL_STATES, LIVE_STATES, MESSAGE_CALLS_PER_DAY, ORGANIZATION_CALLS_PER_MINUTE, cube, submissionsMigrations,
} from "./index.ts"

const statements = submissionsMigrations.flatMap((migration) => migration.statements)
const statement = (prefix: string): string => {
  const found = statements.find((candidate) => candidate.startsWith(prefix))
  assert.ok(found !== undefined, prefix)
  return found
}
const quoted = (values: ReadonlyArray<string>): string => values.map((value) => `'${value}'`).join(",")

void test("declares submissions as a required child of e-Factura, owning exactly the tables its baseline creates", () => {
  assert.equal(cube.manifest.name, "submissions")
  assert.equal(cube.manifest.parent, "efactura")
  assert.equal(cube.manifest.required, true)
  assert.deepEqual(submissionsMigrations.map(({ name }) => name), ["efactura-submissions-001-baseline"])
  const created = statements.map((sql) => /^CREATE TABLE (\w+)\(/u.exec(sql)?.[1]).filter((name) => name !== undefined)
  assert.deepEqual(created, cube.manifest.tables)
})

void test("the baseline spells the same states, outcomes and limits as the domain", () => {
  const submissions = statement("CREATE TABLE efactura_submissions(")
  assert.ok(submissions.includes(`CHECK(state IN(${quoted(FISCAL_STATES)}))`))
  assert.ok(submissions.includes(`CHECK(archive_state IN(${quoted(ARCHIVE_STATES)}))`))
  assert.ok(statement("CREATE UNIQUE INDEX efactura_submissions_current ").endsWith(`WHERE NOT superseded AND state IN(${quoted(LIVE_STATES)})`))
  assert.ok(statement("CREATE TABLE efactura_submission_attempts(").includes(`CHECK(outcome IN(${quoted(CALL_OUTCOMES)}))`))
  assert.ok(statement("CREATE TABLE efactura_message_budgets(").includes(
    `CHECK(used BETWEEN 1 AND CASE operation WHEN 'stareMesaj' THEN ${String(MESSAGE_CALLS_PER_DAY.stareMesaj)} ELSE ${String(MESSAGE_CALLS_PER_DAY.descarcare)} END)`))
  assert.ok(statement("CREATE TABLE efactura_rate_limits(").includes(`CHECK(used BETWEEN 0 AND ${String(ORGANIZATION_CALLS_PER_MINUTE)})`))
})

void test("an accepted submission can never be superseded, and the sent XML can never change", () => {
  assert.ok(statement("CREATE TABLE efactura_submissions(").includes("CHECK(NOT superseded OR state='unknown')"))
  const content = statement("CREATE TRIGGER efactura_submissions_content_no_update ")
  for (const column of ["xml", "xml_sha256", "xml_size", "cif", "environment", "document_id"]) assert.match(content, new RegExp(`[ ,]${column}[ ,]`, "u"), column)
  for (const table of ["efactura_resubmissions", "efactura_submission_attempts", "efactura_responses"]) {
    assert.ok(statement(`CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} `))
    assert.ok(statement(`CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} `))
  }
})
