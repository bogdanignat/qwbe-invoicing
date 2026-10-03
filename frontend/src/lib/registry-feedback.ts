/**
 * What the two master-data screens say after a write, and what they ask before
 * a deletion.
 *
 * The legacy app pushed these through a global toast; this frontend has none,
 * so each screen keeps its own notice next to the panel that changed. The
 * wording lives here rather than in the components because it states a fact
 * about the domain — an issued document keeps its own copy of the party and of
 * the line, so deleting the registry record changes nothing already issued —
 * and that sentence must be identical on both screens.
 */
export type RegistryWrite = "created" | "updated" | "deleted"

const CUSTOMER_NOTICES: Readonly<Record<RegistryWrite, string>> = {
  created: "Clientul a fost creat.",
  updated: "Clientul a fost actualizat.",
  deleted: "Clientul a fost șters.",
}

const PRODUCT_NOTICES: Readonly<Record<RegistryWrite, string>> = {
  created: "Produsul a fost adăugat.",
  updated: "Produsul a fost actualizat.",
  deleted: "Produsul a fost șters.",
}

export const customerNotice = (write: RegistryWrite): string => CUSTOMER_NOTICES[write]

export const productPresetNotice = (write: RegistryWrite): string => PRODUCT_NOTICES[write]

export const customerDeleteConfirm = (name: string): string =>
  `Ștergi clientul „${name}”? Facturile deja emise rămân neschimbate.`

export const productPresetDeleteConfirm = (description: string): string =>
  `Ștergi produsul „${description}”? Liniile deja completate rămân neschimbate.`
