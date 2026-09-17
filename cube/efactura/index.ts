/**
 * The e-Factura generator.
 *
 * The cube is pure: it turns an already-frozen fiscal snapshot into UBL 2.1
 * bytes and refuses anything it cannot render correctly. It owns no table, no
 * HTTP group and no transport — submission to the SPV, status polling and
 * persistence live outside it, so that rendering can be tested, replayed and
 * compared byte for byte without touching the network.
 *
 * The host maps invoicing's model into `EFacturaDocument`; this cube never
 * reads the invoicing cube.
 */

export * from "./contracts/document.ts"
export { EFacturaContractViolation, type EFacturaFailure } from "./contracts/failures.ts"
export { ANONYMOUS_BUYER_IDENTIFIER, DEFAULT_CIUS_RO_PROFILE, type EFacturaProfile } from "./profile.ts"
export { VATEX_NOT_SUBJECT } from "./vat-rules.ts"
export { validateEFacturaDocument } from "./validation.ts"
export { renderEFacturaXml } from "./ubl.ts"
