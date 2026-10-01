#!/usr/bin/env node
import { Effect } from "effect"

import { documentsPermissions } from "../cube/invoicing/documents/index.ts"
import { reconcileArtifacts } from "../standalone/documents/artifact-reconciliation.ts"
import { createStandaloneArtifactService } from "../standalone/documents/artifact-runtime.ts"
import { executeBackup, executeRestore, planRestore, restoreTrustWarning } from "../standalone/ops/postgres-backup.ts"
import { CliInputError, helpText, parseCommand, type Command } from "../standalone/ops/cli.ts"
import { doctorReport } from "../standalone/ops/cli-doctor.ts"
import { runtimeConfig } from "../standalone/config.ts"
import { applicationReady, startServer } from "../standalone/http/http.ts"
import { runShutdown } from "../standalone/http/shutdown.ts"
import { applyMigrations, planMigrations, schemaDrift } from "../standalone/storage/migrations.ts"
import { startMaintenanceSession } from "../standalone/storage/postgres-maintenance-session.ts"
import { cliRedactor, failureMessage } from "../standalone/ops/cli-redaction.ts"
import { createPostgresRuntime, createQueryRuntime } from "../standalone/storage/postgres-pool.ts"
import { cachedReadiness, readinessIntervalMs } from "../standalone/http/readiness.ts"

/**
 * The CLI. Two rules it exists to hold:
 *
 * 1. `serve` NEVER migrates. It takes the maintenance barrier SHARED, listens
 *    regardless, and answers 503 until the barrier, the schema and the artifact
 *    directory all agree.
 * 2. Every command that is not `serve` ends its pool in a `finally`. `serve`
 *    does not: the pool outlives the command and dies with the signal handler.
 */

const print = (value: unknown, json: boolean) => {
  console.log(json ? JSON.stringify(value) : value)
}

/**
 * `serve` already reported its own failure and released everything it held. The
 * outer catch must not print a second, less specific message on top of it.
 */
class ServeAborted extends Error {
  override readonly name = "ServeAborted"
}

let command: Command | undefined
try {
  command = parseCommand(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof CliInputError ? error.message : "invalid command input")
  process.exitCode = 2
}

if (command !== undefined) {
  // Declared outside the `try` so the final `catch` can use it: a configuration
  // failure happens before the secret is known, and then the pattern redactor
  // alone is what is available.
  let redact = cliRedactor("")
  try {
    const config = runtimeConfig()
    // Every diagnostic this process prints goes through here: the pattern
    // redactor plus the literal secret that was read from the file.
    redact = cliRedactor(config.pgSettings.password)
    const reportPoolError = (message: string) => { console.error(`database pool: ${redact(message)}`) }
    const settings = { ...config.pgSettings, onPoolError: reportPoolError }

    if (command.name === "help") print(helpText, false)
    if (command.name === "serve") {
      // Two pools: queries, and the dedicated connection the shared barrier
      // lives on. Neither is closed here on success — the signal handler is.
      const runtime = createPostgresRuntime(settings)
      // HTTP comes up even if the database does not. `startMaintenanceSession`
      // is documented not to reject, and the `catch` is belt and braces: the
      // port must open and `/health/live` must answer 200 regardless, with
      // `/health/ready` and `/api*` answering 503 until the barrier is held.
      const barrier = await startMaintenanceSession(runtime.maintenance, {
        onLost: (reason) => { console.error(`maintenance barrier: ${reason}`) },
        onAcquired: () => { console.log("maintenance barrier: held") },
      }).catch((error: unknown) => {
        console.error(`maintenance barrier: ${failureMessage(redact, error)}`)
        return { held: () => false, state: () => "acquiring" as const, release: async () => {} }
      })
      let acceptingTraffic = true
      const ready = cachedReadiness(
        applicationReady(config, runtime.pool, barrier.held, (reason) => {
          console.error(`readiness: ${reason} (barrier ${barrier.state()})`)
        }),
        readinessIntervalMs,
      )
      // A failed `listen` (EADDRINUSE, EACCES) must not leave a hung process
      // holding the SHARED barrier: `migrate`/`backup`/`restore` would refuse
      // until it was SIGKILLed, and `restart: unless-stopped` never fires for a
      // process that merely hangs. `startServer` has already disposed the API
      // handler by the time it rejects; the barrier and both pools are ours.
      let running: Awaited<ReturnType<typeof startServer>>
      try {
        running = await startServer(config, runtime.pool, async () => acceptingTraffic && await ready())
      } catch (error) {
        acceptingTraffic = false
        // The failure code is set before anything is awaited. The abandon timer
        // below is `unref`'d, so if the loop drains while the release and the
        // close are still pending, Node exits on its own — with 0 if the code was
        // not set yet, which would report a failed boot as success to anything
        // keyed on exit status.
        process.exitCode = 1
        console.error(`serve could not listen: ${failureMessage(redact, error)}`)
        // Bounded: if the release or the drain cannot finish, the process still
        // exits instead of waiting on a socket that will never close.
        const abandon = setTimeout(() => { process.exit(1) }, 10_000)
        abandon.unref()
        await barrier.release().catch(() => undefined)
        await runtime.close().catch(() => undefined)
        clearTimeout(abandon)
        throw new ServeAborted()
      }
      const close = () => {
        if (!acceptingTraffic) return
        acceptingTraffic = false
        // Symmetric with the failed-boot path above, and for the same reason: the
        // old chain skipped the release and the pool close whenever the drain
        // rejected, and its deadline only cut the connections — the maintenance
        // client keeps the event loop alive, so the process hung until Docker's
        // SIGKILL (137). `runShutdown` keeps the order (drain, then the query
        // pool, then the barrier, then the rest), attempts every step anyway and
        // answers with the exit code. `closeQueries` is what earns the release:
        // destroying a socket does not end the request behind it, and only the
        // query pool's `end()` waits for the writes and then refuses the next
        // client.
        //
        // The failure code is set before anything is awaited, exactly as at the
        // failed-boot path: the deadline timer is `unref`'d, so a loop that
        // drains while a step is still pending exits on its own — with 0 if the
        // code was not set yet, reporting an unfinished shutdown as success.
        // A completed sequence overwrites it with its own answer.
        process.exitCode = 1
        void runShutdown({
          drain: () => running.close(),
          destroyConnections: () => { running.server.closeAllConnections() },
          endQueries: () => runtime.closeQueries(),
          releaseBarrier: () => barrier.release(),
          closePools: () => runtime.close(),
          report: (step, error) => { console.error(`shutdown ${step}: ${failureMessage(redact, error)}`) },
          abandon: () => { process.exit(1) },
          deadlineMs: 10_000,
        }).then((code) => { process.exitCode = code })
      }
      process.once("SIGINT", close)
      process.once("SIGTERM", close)
    }
    if (command.name === "doctor") {
      const runtime = createQueryRuntime(settings)
      try {
        const report = await doctorReport(config, runtime.pool)
        print(report, command.json)
        if (!report.ready) process.exitCode = 1
      } finally {
        await runtime.close()
      }
    }
    if (command.name === "migrate") {
      if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("migrate --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const runtime = createQueryRuntime(settings)
        try {
          // A schema the recorded history does not explain (an edited baseline)
          // cannot be migrated forward, so migrate refuses before writing. The
          // check repeats after apply, so a migration that leaves drift behind
          // is refused too. `applyMigrations` takes the barrier EXCLUSIVE with a
          // bounded try: a running application makes it refuse, not hang.
          const before = await schemaDrift(runtime.pool)
          const applying = command.apply && before.length === 0
          const report = applying
            ? await applyMigrations(runtime.pool)
            : await planMigrations(runtime.pool)
          const drifted = applying ? await schemaDrift(runtime.pool) : before
          print({ ...report, schemaDrift: drifted }, command.json)
          if (drifted.length > 0) {
            console.error(`schema does not match the migration contract (${drifted.join(", ")}); recreate the database`)
            process.exitCode = 1
          }
        } finally {
          await runtime.close()
        }
      }
    }
    if (command.name === "artifacts") {
      if (config.organizationId === undefined || config.organizationId.trim().length === 0) {
        console.error("artifacts requires ORGANIZATION_ID")
        process.exitCode = 2
      } else if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("artifacts --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const runtime = createQueryRuntime(settings)
        try {
          const service = createStandaloneArtifactService(config.dataDirectory, runtime.pool, Effect.succeed({
            identity: {
              id: "standalone-operator",
              permissions: [documentsPermissions.read, documentsPermissions.render],
            },
            organization: { id: config.organizationId },
          }))
          const report = await reconcileArtifacts(service, command.limit, command.apply)
          print(report, command.json)
          if (report.failed > 0) process.exitCode = 1
        } finally {
          await runtime.close()
        }
      }
    }
    if (command.name === "backup") {
      const runtime = createQueryRuntime(settings)
      try {
        const report = await executeBackup({
          pool: runtime.pool, settings: config.pgSettings, dataDirectory: config.dataDirectory,
        }, command.output)
        print(report, command.json)
        if (report.failed > 0) process.exitCode = 1
      } finally {
        await runtime.close()
      }
    }
    if (command.name === "restore") {
      if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("restore --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const runtime = createQueryRuntime(settings)
        try {
          const context = {
            pool: runtime.pool, settings: config.pgSettings, dataDirectory: config.dataDirectory,
          }
          // `database.sql` is executed by `psql` as this application's own role, and
          // the manifest digests live inside the same archive as the file they
          // describe: they prove integrity, never authenticity. So the trust boundary
          // is stated before the write, on stderr — `--json` consumers keep a clean
          // stdout, and a dry run says nothing it is not about to do.
          if (command.apply) console.error(restoreTrustWarning)
          // One scan, used for both numbers: two independent scans could
          // disagree and the operator would read an inconsistent plan.
          const report = command.apply
            ? await executeRestore(context, command.input)
            : await (async () => {
              const planned = await planRestore(context, command.input)
              return {
                dataDirectory: config.dataDirectory,
                input: command.input,
                scanned: planned.pending.length,
                restored: 0,
                failed: 0,
                files: planned.pending,
                dryRun: true,
              }
            })()
          print(report, command.json)
          if (report.failed > 0) process.exitCode = 1
        } finally {
          await runtime.close()
        }
      }
    }
  } catch (error) {
    // Redacted, cause chain included: a `pg` error carries the connection
    // configuration, password included, and a wrapper hides it one level down.
    if (!(error instanceof ServeAborted)) console.error(failureMessage(redact, error))
    process.exitCode = 1
  }
}
