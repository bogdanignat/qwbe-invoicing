import { randomUUID } from "node:crypto"

import { Effect } from "effect"
import type { Pool } from "pg"

import type { ConnectionHost } from "../../../cubes/invoicing/efactura/connection/index.ts"
import type { Transport } from "../../outbound/send.ts"
import { createPostgresConnectionStore } from "../../storage/postgres-efactura-connection.ts"
import type { AnafSettings } from "./config.ts"
import { createAnafGateway } from "./oauth-gateway.ts"

/** A test config built by hand carries no ANAF settings: not configured, `test`. */
export const ANAF_NOT_CONFIGURED: AnafSettings = { environment: "test", client: undefined }

/** What the connection services run on: this database, ANAF through `transport`, and the configured client (if any). */
export const connectionHost = (pool: Pool, settings: AnafSettings, transport: Transport, now?: () => Date): ConnectionHost => ({
  clock: { now: Effect.sync(now ?? (() => new Date())) },
  ids: { next: Effect.sync(randomUUID) },
  store: createPostgresConnectionStore(pool, settings.client, settings.environment),
  anaf: settings.client === undefined ? undefined : createAnafGateway(settings.client, settings.environment, transport),
  environment: settings.environment,
})
