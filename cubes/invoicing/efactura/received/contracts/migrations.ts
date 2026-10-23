import migrations from "./migrations.json" with { type: "json" }

export interface ReceivedMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

/**
 * The received invoices' tables: the fetch a user asked for, the messages ANAF
 * listed for it, ANAF's ZIP exactly as it came (immutable), what was read out
 * of it (a read invoice, or why it is unreadable; replaced on a reread), and
 * how far the organization's received invoices are fetched completely.
 */
export const receivedMigrations: ReadonlyArray<ReceivedMigration> = migrations
