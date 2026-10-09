/**
 * The CIUS-RO lengths e-Factura refuses beyond (BR-RO-L200/L150/L050/L020/L100),
 * mirrored from `CIUS_TEXT_LIMITS` in cube/invoicing/domain/validation.ts and held
 * equal to it by probes/frontend-cube-parity.test.mjs. The server counts characters
 * after normalize-space; the native `maxLength` counts UTF-16 units, so the form is
 * at most stricter than the server, never more permissive.
 */
export const CIUS_TEXT_LIMITS = { partyName: 200, street: 150, city: 50, postalCode: 20, lineDescription: 100 } as const
