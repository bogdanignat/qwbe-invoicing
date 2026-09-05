const identity = "corrections"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { createCorrectionOperations } from "./application/corrections.ts"
export type { CorrectionOperations } from "./application/corrections.ts"
export { negateMoney, validateCreateCorrectionInput } from "./domain/corrections.ts"
export type { CorrectionDocument, CreateCorrectionInput } from "./domain/corrections.ts"
