import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

import { bodyObject } from "./schema-primitives.ts"

export const Artifact = Schema.Struct({
  invoiceId: Schema.String, organizationId: Schema.String, objectKey: Schema.String,
  sha256: Schema.String, byteLength: Schema.Int, mediaType: Schema.Literal("application/pdf"),
  templateVersion: Schema.String, generatedAt: Schema.String,
})
export const ProformaArtifact = Schema.Struct({
  proformaId: Schema.String, organizationId: Schema.String, objectKey: Schema.String,
  sha256: Schema.String, byteLength: Schema.Int, mediaType: Schema.Literal("application/pdf"),
  templateVersion: Schema.String, generatedAt: Schema.String,
})
export const EmptyInput = Schema.Struct({}).annotations(bodyObject).pipe(
  Schema.filter((value) => typeof value === "object" && !Array.isArray(value), { ...bodyObject, jsonSchema: { type: "object" } }),
  Schema.transform(Schema.Struct({}), { strict: true, decode: (): Record<string, never> => ({}), encode: () => ({}) }),
)
export const Pdf = HttpApiSchema.Uint8Array({ contentType: "application/pdf" })
export const EFacturaXml = HttpApiSchema.Uint8Array({ contentType: "application/xml" })
