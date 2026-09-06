export interface PaymentsMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
  readonly foreignKeys?: "off"
}
