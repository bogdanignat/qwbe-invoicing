import assert from "node:assert/strict"
import { randomBytes } from "node:crypto"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Redacted } from "effect"

import { runtimeConfig } from "../config.ts"
import { openKey, sealKey } from "./key-cipher.ts"

const master = Redacted.make(randomBytes(32))
const key = Redacted.make("sk_test_0123456789wxyz")

void test("a sealed key opens back, for its organization and its master key only", () => {
  const sealed = sealKey(master, "org-1", key)
  assert.equal(Redacted.value(openKey(master, "org-1", sealed) ?? Redacted.make("")), "sk_test_0123456789wxyz")
  assert.equal(sealed.includes("sk_test"), false)
  assert.match(sealed, /^v1\.[\w-]+\.[\w-]+\.[\w-]+$/u)
  assert.equal(openKey(master, "org-2", sealed), undefined, "another organization")
  assert.equal(openKey(Redacted.make(randomBytes(32)), "org-1", sealed), undefined, "another master key")
})

void test("every write takes a fresh IV", () => {
  const first = sealKey(master, "org-1", key)
  const second = sealKey(master, "org-1", key)
  assert.notEqual(first, second)
  assert.notEqual(first.split(".")[1], second.split(".")[1])
})

void test("a changed byte anywhere is refused, not decrypted", () => {
  const sealed = sealKey(master, "org-1", key)
  const parts = sealed.split(".")
  for (const index of [1, 2, 3]) {
    const bytes = Buffer.from(parts[index] ?? "", "base64url")
    bytes[0] = (bytes[0] ?? 0) ^ 1
    const tampered = parts.map((part, at) => at === index ? bytes.toString("base64url") : part).join(".")
    assert.equal(openKey(master, "org-1", tampered), undefined, `part ${String(index)}`)
  }
  for (const malformed of ["", "v1", "v2.a.b.c", `${sealed}.extra`, "v1.a.b"]) assert.equal(openKey(master, "org-1", malformed), undefined, malformed)
})

void test("the master key comes from COMPANY_LOOKUP_KEY_FILE, 64 hex characters, never quoted in an error", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-master-"))
  const file = (name: string, content: string) => {
    const path = join(directory, name)
    writeFileSync(path, content, { mode: 0o600 })
    return path
  }
  const hex = randomBytes(32).toString("hex")
  const config = (path?: string) => runtimeConfig({ NODE_ENV: "test", ...(path === undefined ? {} : { COMPANY_LOOKUP_KEY_FILE: path }) })
  assert.equal(config().companyLookupKey, undefined, "unset: no master key, and the application still starts")
  const loaded = config(file("good", `${hex}\n`)).companyLookupKey
  assert.ok(loaded !== undefined)
  assert.equal(Redacted.value(loaded).toString("hex"), hex)
  assert.equal(JSON.stringify({ loaded }).includes(hex), false, "the loaded key does not print")
  assert.throws(() => config(join(directory, "missing")), /COMPANY_LOOKUP_KEY_FILE is not readable/u)
  const short = hex.slice(0, 62)
  assert.throws(() => config(file("short", short)), (error: Error) =>
    /must hold 64 hex characters/u.test(error.message) && !error.message.includes(short))
})
