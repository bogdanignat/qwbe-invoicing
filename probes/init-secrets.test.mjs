import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { URL, fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("../scripts/init-secrets.sh", import.meta.url))
const keys = ["AUTH_TOKEN_PATH", "PG_PASSWORD_PATH", "COMPANY_LOOKUP_KEY_PATH", "ANAF_TOKEN_KEY_PATH"]
const files = { AUTH_TOKEN_PATH: "api-token", PG_PASSWORD_PATH: "pg-password", COMPANY_LOOKUP_KEY_PATH: "company-lookup-key", ANAF_TOKEN_KEY_PATH: "anaf-token-key" }

/** A scratch directory with a `.env` of the given lines; removed after the test. */
const scratch = (t, lines) => {
  const root = mkdtempSync(join(tmpdir(), "init-secrets-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, ".env"), `${lines.join("\n")}\n`)
  return root
}
const defaultLines = keys.map((key) => `${key}=./.local/${files[key]}`)
// POSIX `sh`, as in the verifier image (busybox) and on any host.
const run = (...args) => spawnSync("sh", [script, ...args], { encoding: "utf8" })
const mode = (path) => statSync(path).mode & 0o777

void test("creates the four secrets as 64 hex characters, 0600 in a 0700 directory, and prints none of them", (t) => {
  const root = scratch(t, defaultLines)
  const result = run(join(root, ".env"))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(mode(join(root, ".local")), 0o700)
  for (const key of keys) {
    const path = join(root, ".local", files[key])
    const secret = readFileSync(path, "utf8").trim()
    assert.match(secret, /^[0-9a-f]{64}$/u)
    assert.equal(mode(path), 0o600)
    assert.ok(!result.stdout.includes(secret) && !result.stderr.includes(secret), `${key} must not be printed`)
    assert.match(result.stdout, new RegExp(`created +${key}`, "u"))
  }
})

void test("is idempotent: a second run keeps every existing secret byte for byte", (t) => {
  const root = scratch(t, defaultLines)
  mkdirSync(join(root, ".local"), { mode: 0o700 })
  writeFileSync(join(root, ".local", "pg-password"), "kept-by-the-operator\n", { mode: 0o600 })
  assert.equal(run(join(root, ".env")).status, 0)
  const before = keys.map((key) => readFileSync(join(root, ".local", files[key]), "utf8"))
  assert.equal(before[1], "kept-by-the-operator\n")
  const again = run(join(root, ".env"))
  assert.equal(again.status, 0, again.stderr)
  assert.deepEqual(keys.map((key) => readFileSync(join(root, ".local", files[key]), "utf8")), before)
  for (const key of keys) assert.match(again.stdout, new RegExp(`kept +${key}`, "u"))
})

void test("refuses a path it cannot read the way Compose would, and writes nothing", (t) => {
  for (const value of ["$HOME/api-token", "./a b", "./x # comment", "'./a'b'", "\"\"", ""]) {
    const root = scratch(t, [`AUTH_TOKEN_PATH=${value}`, ...defaultLines.slice(1)])
    const result = run(join(root, ".env"))
    assert.equal(result.status, 1, `AUTH_TOKEN_PATH=${value} must be refused`)
    assert.match(result.stderr, /AUTH_TOKEN_PATH .*plain file path/u)
    assert.equal(existsSync(join(root, ".local")), false, "nothing is written before every path is valid")
  }
})

void test("refuses a missing key, a missing env file and extra arguments", (t) => {
  const root = scratch(t, defaultLines.slice(0, 2))
  const missingKey = run(join(root, ".env"))
  assert.equal(missingKey.status, 1)
  assert.match(missingKey.stderr, /COMPANY_LOOKUP_KEY_PATH is not set/u)
  const withoutAnafKey = scratch(t, defaultLines.slice(0, 3))
  const missingAnafKey = run(join(withoutAnafKey, ".env"))
  assert.equal(missingAnafKey.status, 1)
  assert.match(missingAnafKey.stderr, /ANAF_TOKEN_KEY_PATH is not set/u)
  assert.equal(existsSync(join(withoutAnafKey, ".local")), false, "no secret is written while one path is missing")
  assert.equal(existsSync(join(root, ".local")), false)
  assert.equal(run(join(root, "absent.env")).status, 1)
  assert.equal(run(join(root, ".env"), "extra").status, 2)
})

void test("refuses an empty secret file and a symlink instead of replacing them", (t) => {
  const empty = scratch(t, defaultLines)
  mkdirSync(join(empty, ".local"))
  writeFileSync(join(empty, ".local", "api-token"), "")
  const emptyResult = run(join(empty, ".env"))
  assert.equal(emptyResult.status, 1)
  assert.match(emptyResult.stderr, /exists but is empty/u)
  assert.equal(readFileSync(join(empty, ".local", "api-token"), "utf8"), "")

  const linked = scratch(t, defaultLines)
  mkdirSync(join(linked, ".local"))
  symlinkSync(join(linked, "elsewhere"), join(linked, ".local", "api-token"))
  const linkResult = run(join(linked, ".env"))
  assert.equal(linkResult.status, 1)
  assert.match(linkResult.stderr, /is a symlink/u)
  assert.equal(existsSync(join(linked, "elsewhere")), false)
  assert.ok(lstatSync(join(linked, ".local", "api-token")).isSymbolicLink())
})

void test("never generates the ANAF client secret: it comes from ANAF's portal", (t) => {
  const root = scratch(t, [...defaultLines, "ANAF_CLIENT_SECRET_PATH=./.local/anaf-client-secret"])
  const result = run(join(root, ".env"))
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(root, ".local", "anaf-client-secret")), false)
  assert.doesNotMatch(result.stdout, /ANAF_CLIENT_SECRET_PATH/u)
})
