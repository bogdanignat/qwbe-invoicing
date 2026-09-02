export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
  readonly foreignKeys?: "off"
}
