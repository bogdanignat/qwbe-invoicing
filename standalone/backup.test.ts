import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { executeBackup, executeRestore, planRestore } from "./backup.ts"
import { createBrowserSession } from "./browser-session.ts"
import { applyMigrations } from "./migrations.ts"

void test("backup and restore preserve the session schema without restoring active sessions", () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-backup-sessions-"))
  const source = join(root, "source")
  const backup = join(root, "backup")
  const restored = join(root, "restored")
  const token = "d".repeat(64)
  const tokenFile = join(root, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })

  try {
    applyMigrations(source)
    const config = {
      host: "127.0.0.1",
      port: 3000,
      dataDirectory: source,
      nodeEnvironment: "test",
      authTokenFile: tokenFile,
      organizationId: "org-1",
    }
    const sessions = createBrowserSession(config)
    const login = sessions.login({ token, origin: "http://invoice.test", host: "invoice.test" })
    assert.equal(login.kind, "authenticated")
    const cookie = login.setCookie.split(";", 1)[0] as string
    assert.equal(sessions.resume(cookie).kind, "authenticated")

    executeBackup(source, backup)
    executeRestore(restored, backup)
    const restoredSessions = createBrowserSession({ ...config, dataDirectory: restored })
    assert.deepEqual(restoredSessions.resume(cookie), { kind: "unauthorized" })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

void test("restore rejects manifest paths outside the owned data allowlist", () => {
  const root = mkdtempSync(join(tmpdir(), "qwbe-backup-path-"))
  const backup = join(root, "backup")
  mkdirSync(backup)
  writeFileSync(join(backup, "manifest.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    dataDirectory: "/data",
    files: [{ path: "../../escaped", sha256: "0".repeat(64), byteLength: 0 }],
  }))
  try {
    assert.throws(() => planRestore(join(root, "restore"), backup), /backup path is not allowed/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
