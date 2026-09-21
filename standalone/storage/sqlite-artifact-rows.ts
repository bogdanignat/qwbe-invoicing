import type { InvoiceArtifact, ProformaArtifact } from "../../cube/invoicing/documents/index.ts"

export type ArtifactRow = Readonly<Record<string, unknown>>

export const artifactRow = (value: unknown): ArtifactRow | undefined =>
  typeof value === "object" && value !== null ? value as ArtifactRow : undefined

export const artifactText = (value: ArtifactRow, field: string): string => {
  const result = value[field]
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

const integer = (value: ArtifactRow, field: string): number => {
  const result = value[field]
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

export const artifactFrom = (value: ArtifactRow): InvoiceArtifact => ({
  invoiceId: artifactText(value, "invoice_id"), organizationId: artifactText(value, "organization_id"),
  objectKey: artifactText(value, "object_key"), sha256: artifactText(value, "sha256"),
  byteLength: integer(value, "byte_length"), mediaType: "application/pdf",
  templateVersion: artifactText(value, "template_version"), generatedAt: artifactText(value, "generated_at"),
})

export const proformaArtifactFrom = (value: ArtifactRow): ProformaArtifact => ({
  proformaId: artifactText(value, "proforma_id"), organizationId: artifactText(value, "organization_id"),
  objectKey: artifactText(value, "object_key"), sha256: artifactText(value, "sha256"),
  byteLength: integer(value, "byte_length"), mediaType: "application/pdf",
  templateVersion: artifactText(value, "template_version"), generatedAt: artifactText(value, "generated_at"),
})

export const sameArtifact = (left: InvoiceArtifact, right: InvoiceArtifact): boolean =>
  left.invoiceId === right.invoiceId && left.organizationId === right.organizationId
  && left.objectKey === right.objectKey && left.sha256 === right.sha256
  && left.byteLength === right.byteLength && left.templateVersion === right.templateVersion

export const sameProformaArtifact = (left: ProformaArtifact, right: ProformaArtifact): boolean =>
  left.proformaId === right.proformaId && left.organizationId === right.organizationId
  && left.objectKey === right.objectKey && left.sha256 === right.sha256
  && left.byteLength === right.byteLength && left.templateVersion === right.templateVersion
