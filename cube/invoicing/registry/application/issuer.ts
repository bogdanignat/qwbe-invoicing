import { Effect } from "effect"

import { checked, copyParty, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries, IssuerBrandingImage, IssuerProfile } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput, ConfigureIssuerInput } from "../../domain/inputs.ts"
import { validateDocumentSeries } from "../../domain/validation.ts"
import { normalizeBrandingText, validateIssuer } from "../domain/validation.ts"

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
}

const maximumImageBytes = 256 * 1024
const maximumBase64Characters = 349_528
const base64Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

const decodeStrictBase64 = (value: string): Uint8Array => {
  if (value.length === 0 || value.length > maximumBase64Characters || value.length % 4 !== 0
    || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new ValidationFailure({ issues: ["branding.image.dataBase64 must be strict base64 of at most 256 KiB"] })
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  const byteLength = value.length / 4 * 3 - padding
  const finalDataIndex = value.length - padding - 1
  const finalBits = base64Alphabet.indexOf(value[finalDataIndex] ?? "")
  if (byteLength > maximumImageBytes || finalBits < 0
    || (padding === 2 && (finalBits & 15) !== 0) || (padding === 1 && (finalBits & 3) !== 0)) {
    throw new ValidationFailure({ issues: ["branding.image.dataBase64 must be strict base64 of at most 256 KiB"] })
  }
  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (let index = 0; index < value.length; index += 4) {
    const a = base64Alphabet.indexOf(value[index] ?? "")
    const b = base64Alphabet.indexOf(value[index + 1] ?? "")
    const c = value[index + 2] === "=" ? 0 : base64Alphabet.indexOf(value[index + 2] ?? "")
    const d = value[index + 3] === "=" ? 0 : base64Alphabet.indexOf(value[index + 3] ?? "")
    bytes[offset++] = (a << 2) | (b >> 4)
    if (offset < byteLength) bytes[offset++] = ((b & 15) << 4) | (c >> 2)
    if (offset < byteLength) bytes[offset++] = ((c & 3) << 6) | d
  }
  return bytes
}

const validateCanonicalImage = (image: IssuerBrandingImage): void => {
  const bytes = decodeStrictBase64(image.pngBase64)
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!Number.isInteger(image.width) || image.width < 1 || image.width > 2048
    || !Number.isInteger(image.height) || image.height < 1 || image.height > 2048 || image.width * image.height > 4_000_000
    || signature.some((byte, index) => bytes[index] !== byte)) {
    throw new ValidationFailure({ issues: ["branding normalizer returned an invalid canonical PNG image"] })
  }
}

export const createIssuerOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): IssuerOperations => {
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const text = yield* checked(() => normalizeBrandingText(input.branding?.text ?? null))
    const rawImage = yield* checked(() => input.branding?.image === null || input.branding === null
      ? null
      : decodeStrictBase64(input.branding.image.dataBase64))
    const issuer: IssuerProfile = {
      ...copyParty(input), organizationId: context.organization.id,
      defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays,
      vatConfigurations: structuredClone(input.vatConfigurations),
      branding: null,
    }
    yield* checked(() => { validateIssuer(issuer) })
    if (input.branding !== null && text === null && rawImage === null) {
      return yield* Effect.fail(new ValidationFailure({ issues: ["branding must contain text, image, or both"] }))
    }
    const image = rawImage === null ? null : yield* dependencies.branding.normalize(rawImage)
    if (image !== null) yield* checked(() => { validateCanonicalImage(image) })
    const configured: IssuerProfile = {
      ...issuer,
      branding: input.branding === null ? null : { text, image },
    }
    yield* dependencies.store.transaction((transaction) => transaction.saveIssuer(configured))
    return structuredClone(configured)
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : structuredClone(issuer)
  })
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    yield* dependencies.store.transaction((transaction) => transaction.addDocumentSeries(series))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
  return { configureIssuer, getIssuer, addDocumentSeries, listDocumentSeries }
}
