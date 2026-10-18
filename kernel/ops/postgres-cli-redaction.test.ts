import assert from "node:assert/strict"
import test from "node:test"

import { cliRedactor, failureMessage } from "./cli-redaction.ts"

void test("the literal secret is removed, not only the password= pattern", () => {
  const redact = cliRedactor("s3cr3t-value")
  assert.equal(
    redact("connection failed: password=s3cr3t-value host=db"),
    "connection failed: password=[redacted] host=db",
  )
  assert.equal(redact("pg_dump: error: s3cr3t-value rejected"), "pg_dump: error: [redacted] rejected")
  assert.equal(redact("postgres://qwbe:s3cr3t-value@db:5432/x"), "postgres://qwbe:[redacted]@db:5432/x")
})

void test("an empty secret does not redact every empty string", () => {
  assert.equal(cliRedactor("")("plain failure"), "plain failure")
})

void test("a wrapped cause chain is redacted too, and bounded", () => {
  const redact = cliRedactor("s3cr3t-value")
  const inner = new Error("auth failed for s3cr3t-value")
  const outer = new Error("migrate failed", { cause: inner })
  assert.equal(failureMessage(redact, outer), "migrate failed: auth failed for [redacted]")
  assert.equal(failureMessage(redact, "not an error"), "unknown execution failure")
})
