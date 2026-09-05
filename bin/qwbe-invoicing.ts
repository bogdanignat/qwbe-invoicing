#!/usr/bin/env node
import { accessSync, constants } from "node:fs"

import { Effect } from "effect"

import { documentsPermissions } from "../cube/invoicing/documents/index.ts"
import { reconcileArtifacts } from "../standalone/artifact-reconciliation.ts"
import { createStandaloneArtifactService } from "../standalone/artifact-runtime.ts"
import { executeBackup, executeRestore, planRestore } from "../standalone/backup.ts"
import { CliInputError, helpText, parseCommand, type Command } from "../standalone/cli.ts"
import { runtimeConfig } from "../standalone/config.ts"
import { startServer } from "../standalone/http.ts"
import { applyMigrations, databaseReady, planMigrations } from "../standalone/migrations.ts"
import { cachedReadiness, readinessIntervalMs } from "../standalone/readiness.ts"

const print = (value: unknown, json: boolean) => {
  console.log(json ? JSON.stringify(value) : value)
}

let command: Command | undefined
try {
  command = parseCommand(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof CliInputError ? error.message : "invalid command input")
  process.exitCode = 2
}

if (command !== undefined) {
  try {
    const config = runtimeConfig()

    if (command.name === "help") print(helpText, false)
    if (command.name === "serve") {
      let acceptingTraffic = true
      const storageReady = cachedReadiness(() => databaseReady(config.dataDirectory), readinessIntervalMs)
      const server = startServer(config, () => acceptingTraffic && storageReady())
      const close = () => {
        if (!acceptingTraffic) return
        acceptingTraffic = false
        const deadline = setTimeout(() => {
          server.closeAllConnections()
          process.exitCode = 1
        }, 10_000)
        server.close(() => {
          clearTimeout(deadline)
          process.exitCode = 0
        })
      }
      process.once("SIGINT", close)
      process.once("SIGTERM", close)
    }
    if (command.name === "doctor") {
      let writable = true
      try {
        accessSync(config.dataDirectory, constants.R_OK | constants.W_OK)
      } catch {
        writable = false
      }
      const pending = planMigrations(config.dataDirectory).pending
      const authTokenReadable = (() => {
        if (config.authTokenFile === undefined) return false
        try {
          accessSync(config.authTokenFile, constants.R_OK)
          return true
        } catch {
          return false
        }
      })()
      const report = {
        dataDirectory: config.dataDirectory,
        writable,
        databaseReady: databaseReady(config.dataDirectory),
        pendingMigrations: pending,
        migrationsReady: pending.length === 0,
        organizationId: config.organizationId ?? null,
        authTokenFile: config.authTokenFile ?? null,
        authTokenReadable,
        nodeVersion: process.versions.node,
      }
      print(report, command.json)
      if (!writable || !report.databaseReady || !report.migrationsReady) process.exitCode = 1
    }
    if (command.name === "migrate") {
      if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("migrate --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const report = command.apply ? applyMigrations(config.dataDirectory) : planMigrations(config.dataDirectory)
        print(report, command.json)
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
        const service = createStandaloneArtifactService(config.dataDirectory, Effect.succeed({
          identity: {
            id: "standalone-operator",
            permissions: [documentsPermissions.read, documentsPermissions.render],
          },
          organization: { id: config.organizationId },
        }))
        const report = await reconcileArtifacts(service, command.limit, command.apply)
        print(report, command.json)
        if (report.failed > 0) process.exitCode = 1
      }
    }
    if (command.name === "backup") {
      const report = executeBackup(config.dataDirectory, command.output)
      print(report, command.json)
      if (report.failed > 0) process.exitCode = 1
    }
    if (command.name === "restore") {
      if (command.apply && config.nodeEnvironment !== "development" && !command.confirmProduction) {
        console.error("restore --apply outside development requires --confirm-production")
        process.exitCode = 2
      } else {
        const report = command.apply ? executeRestore(config.dataDirectory, command.input) : (() => {
          const planned = planRestore(config.dataDirectory, command.input)
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
        const failed = (report as { failed?: number }).failed ?? 0
        if (failed > 0) process.exitCode = 1
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "unknown execution failure")
    process.exitCode = 1
  }
}
