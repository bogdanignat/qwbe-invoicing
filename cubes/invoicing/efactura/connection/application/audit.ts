import { Effect } from "effect"

import type { AuditEvent } from "../../../domain/invoice.ts"
import type { ConnectionHost } from "./ports.ts"

/** `efactura_connection.<action>`, appended in the transaction that makes the change. */
export const connectionAudit = (
  host: ConnectionHost, organizationId: string, actorId: string, at: Date,
  action: "connected" | "disconnected" | "needs_reconnect", reason?: string,
): Effect.Effect<AuditEvent> => Effect.map(host.ids.next, (id) => ({
  id, organizationId, actorId, occurredAt: at.toISOString(), action: `efactura_connection.${action}`,
  targetKind: "efactura_connection", targetId: organizationId, ...(reason === undefined ? {} : { reason }),
}))
