/**
 * The migrations lock: `pnpm gate:migrations` checks it, `pnpm migrations:lock` appends to it.
 *
 * The decision is `lockUpdate` (kernel/storage/migrations-lock-update.ts); this file only
 * reads the lock, prints the answer and, with `--append`, writes what it allows. A
 * missing or malformed lock, an edited, removed, renamed or moved shipped migration, a
 * locked scope that is gone and a migration inserted before a locked one are refused in
 * both modes, and nothing is written. A migration appended at the end of a scope fails
 * the gate until `--append` records it.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { URL } from "node:url"

import { lockCommand, lockOf } from "../kernel/storage/migrations-lock.ts"
import { lockPath, lockUpdate } from "../kernel/storage/migrations-lock-update.ts"
import { migrationScopes } from "../kernel/storage/postgres-migration-plans.ts"

const lockFile = new URL(`../${lockPath}`, import.meta.url)
const append = process.argv.includes("--append")
const current = lockOf(migrationScopes)
const update = lockUpdate(existsSync(lockFile) ? readFileSync(lockFile, "utf8") : undefined, current)

if (update.kind === "refused") {
  for (const problem of update.problems) console.error(`✗ ${problem}`)
  console.error(`Migrations lock gate failed: ${update.hint}.`)
  process.exitCode = 1
} else if (update.kind === "append" && append) {
  writeFileSync(lockFile, `${JSON.stringify(update.lock, null, 2)}\n`)
  for (const key of update.appended) console.log(`+ ${key}`)
  console.log(`Migrations lock: ${String(update.appended.length)} appended.`)
} else if (update.kind === "append") {
  for (const key of update.appended) console.error(`✗ ${key} is not in the lock`)
  console.error(`Migrations lock gate failed: record new migrations with \`${lockCommand}\` and commit `
    + `${lockPath} with them.`)
  process.exitCode = 1
} else {
  const count = current.reduce((total, scope) => total + scope.migrations.length, 0)
  console.log(`Migrations lock gate passed: ${String(count)} migrations in ${String(current.length)} scopes.`)
}
