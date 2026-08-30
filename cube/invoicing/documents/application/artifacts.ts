import { Effect, Either } from "effect"

import {
  ArtifactConflict,
  DocumentNotFound,
  DocumentsPermissionDenied,
  type ArtifactRepository,
  type DocumentsFailure,
  type InvoiceArtifact,
  type InvoiceRenderer,
  type InvoiceSource,
  type PdfObjectStore,
  type RequestContext,
} from "./artifact-ports.ts"

export interface ArtifactServiceDependencies {
  readonly context: Effect.Effect<RequestContext, DocumentsFailure>
  readonly clock: Effect.Effect<Date>
  readonly repository: ArtifactRepository
  readonly source: InvoiceSource
  readonly renderer: InvoiceRenderer
  readonly objects: PdfObjectStore
  readonly cubeIdentity: string
}

export interface ArtifactService {
  readonly renderInvoice: (invoiceId: string) => Effect.Effect<InvoiceArtifact, DocumentsFailure>
  readonly downloadInvoice: (invoiceId: string) => Effect.Effect<{
    readonly artifact: InvoiceArtifact
    readonly bytes: Uint8Array
  }, DocumentsFailure>
  readonly listMissingInvoiceIds: () => Effect.Effect<ReadonlyArray<string>, DocumentsFailure>
}

const missing = (resource: string, id: string) => new DocumentNotFound({ resource, id })

export const createArtifactService = (dependencies: ArtifactServiceDependencies): ArtifactService => {
  const readPermission = `${dependencies.cubeIdentity}:read`
  const renderPermission = `${dependencies.cubeIdentity}:render`
  const authorized = (permission: string): Effect.Effect<RequestContext, DocumentsFailure> =>
    Effect.flatMap(dependencies.context, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new DocumentsPermissionDenied({ permission })))

  const renderInvoice = (invoiceId: string) => Effect.gen(function*() {
    const context = yield* authorized(renderPermission)
    const existing = yield* dependencies.repository.findArtifact(context.organization.id, invoiceId)
    if (existing !== undefined) {
      const object = yield* Effect.either(dependencies.objects.readPdf(existing))
      if (Either.isRight(object)) return existing
    }
    const invoice = yield* dependencies.source.findInvoice(context.organization.id, invoiceId)
    if (invoice === undefined) return yield* Effect.fail(missing("invoice", invoiceId))
    const rendered = yield* dependencies.renderer.render(invoice)
    const stored = yield* dependencies.objects.putPdf(rendered.bytes)
    if (existing !== undefined) {
      if (stored.objectKey !== existing.objectKey
        || stored.sha256 !== existing.sha256
        || stored.byteLength !== existing.byteLength
        || rendered.templateVersion !== existing.templateVersion) {
        return yield* Effect.fail(new ArtifactConflict({ invoiceId }))
      }
      return existing
    }
    const generatedAt = yield* dependencies.clock
    return yield* dependencies.repository.saveArtifact({
      invoiceId,
      organizationId: context.organization.id,
      objectKey: stored.objectKey,
      sha256: stored.sha256,
      byteLength: stored.byteLength,
      mediaType: rendered.mediaType,
      templateVersion: rendered.templateVersion,
      generatedAt: generatedAt.toISOString(),
    })
  })

  const downloadInvoice = (invoiceId: string) => Effect.gen(function*() {
    const context = yield* authorized(readPermission)
    const artifact = yield* dependencies.repository.findArtifact(context.organization.id, invoiceId)
    if (artifact === undefined) return yield* Effect.fail(missing("invoice artifact", invoiceId))
    const bytes = yield* dependencies.objects.readPdf(artifact)
    return { artifact, bytes }
  })

  const listMissingInvoiceIds = () => Effect.gen(function*() {
    const context = yield* authorized(renderPermission)
    const invoiceIds = yield* dependencies.source.listIssuedInvoiceIds(context.organization.id)
    const missingIds: Array<string> = []
    for (const invoiceId of invoiceIds) {
      const artifact = yield* dependencies.repository.findArtifact(context.organization.id, invoiceId)
      if (artifact === undefined) {
        missingIds.push(invoiceId)
      } else {
        const object = yield* Effect.either(dependencies.objects.readPdf(artifact))
        if (Either.isLeft(object)) missingIds.push(invoiceId)
      }
    }
    return missingIds
  })

  return { renderInvoice, downloadInvoice, listMissingInvoiceIds }
}

export type {
  ArtifactRepository,
  InvoiceArtifact,
  InvoiceRenderer,
  InvoiceSource,
  PdfObjectStore,
  RenderableInvoice,
} from "./artifact-ports.ts"
