import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

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
export const Pdf = HttpApiSchema.Uint8Array({ contentType: "application/pdf" })
export const EFacturaXml = HttpApiSchema.Uint8Array({ contentType: "application/xml" })
