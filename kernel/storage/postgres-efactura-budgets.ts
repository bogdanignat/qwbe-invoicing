import {
  nextBucharestMidnight, pauseAfterRateLimit, reserveMessageCall, reserveOrganizationCall, type BudgetedOperation, type OrganizationBudget,
} from "../../cubes/invoicing/efactura/submissions/index.ts"
import { firstRow, integer, text } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

export interface MessageCall {
  readonly operation: BudgetedOperation
  readonly id: string
}

/**
 * ANAF's call budgets as the dispatcher's transactions keep them: read under
 * a row lock, decided by the cube's pure rules, written back in the same
 * transaction as the step that spends them.
 */
export const budgetStore = (client: TransactionClient, at: Date) => {
  const organizationBudget = async (organizationId: string): Promise<OrganizationBudget | undefined> => {
    const row = firstRow((await client.query(
      "SELECT minute,used,paused_until FROM efactura_rate_limits WHERE organization_id=$1 FOR UPDATE", [organizationId])).rows)
    return row === undefined ? undefined : { minute: text(row, "minute"), used: integer(row, "used"), pausedUntil: text(row, "paused_until") }
  }
  const saveOrganizationBudget = (organizationId: string, budget: OrganizationBudget) => client.query(
    `INSERT INTO efactura_rate_limits(organization_id,minute,used,paused_until) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id)
      DO UPDATE SET minute=EXCLUDED.minute,used=EXCLUDED.used,paused_until=EXCLUDED.paused_until`,
    [organizationId, budget.minute, budget.used, budget.pausedUntil])

  const messageBudget = async (organizationId: string, call: MessageCall) => {
    const row = firstRow((await client.query(`SELECT day,used FROM efactura_message_budgets
      WHERE organization_id=$1 AND operation=$2 AND message_id=$3 FOR UPDATE`, [organizationId, call.operation, call.id])).rows)
    return reserveMessageCall(call.operation, row === undefined ? undefined : { day: text(row, "day"), used: integer(row, "used") }, at)
  }

  return {
    /** One call more for the organization (and the message), stored here; or the instant to come back at. */
    reserve: async (organizationId: string, message?: MessageCall): Promise<string | undefined> => {
      const organization = reserveOrganizationCall(await organizationBudget(organizationId), at)
      if ("waitUntil" in organization) return organization.waitUntil
      const day = message === undefined ? undefined : await messageBudget(organizationId, message)
      if (message !== undefined && day === undefined) return nextBucharestMidnight(at).toISOString()
      if (message !== undefined && day !== undefined) {
        await client.query(`INSERT INTO efactura_message_budgets(organization_id,operation,message_id,day,used) VALUES($1,$2,$3,$4,$5)
          ON CONFLICT(organization_id,operation,message_id) DO UPDATE SET day=EXCLUDED.day,used=EXCLUDED.used`,
        [organizationId, message.operation, message.id, day.day, day.used])
      }
      await saveOrganizationBudget(organizationId, organization.granted)
      return undefined
    },
    /** ANAF answered 429: the whole organization waits. Answers until when. */
    pause: async (organizationId: string, retryAfter: string | null): Promise<string> => {
      const paused = pauseAfterRateLimit(await organizationBudget(organizationId), at, retryAfter)
      await saveOrganizationBudget(organizationId, paused)
      return paused.pausedUntil
    },
  }
}
