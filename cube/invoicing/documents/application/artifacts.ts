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
  type ProformaArtifact,
  type RenderableInvoice,
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
  readonly renderProforma: (proformaId: string) => Effect.Effect<ProformaArtifact, DocumentsFailure>
  readonly downloadProforma: (proformaId: string) => Effect.Effect<{
    readonly artifact: ProformaArtifact
    readonly bytes: Uint8Array
  }, DocumentsFailure>
  readonly listMissingProformaIds: () => Effect.Effect<ReadonlyArray<string>, DocumentsFailure>
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

  const render = <Artifact extends InvoiceArtifact | ProformaArtifact, Source extends RenderableInvoice>(options: {
    readonly kind: "invoice" | "proforma"
    readonly id: string
    readonly findArtifact: (organizationId: string, id: string) => Effect.Effect<Artifact | undefined, DocumentsFailure>
    readonly saveArtifact: (artifact: Artifact) => Effect.Effect<Artifact, DocumentsFailure>
    readonly findSource: (organizationId: string, id: string) => Effect.Effect<Source | undefined, DocumentsFailure>
    readonly renderSource: (source: Source) => Effect.Effect<import("./artifact-ports.ts").RenderedDocument, DocumentsFailure>
    readonly artifact: (common: Omit<InvoiceArtifact, "invoiceId">) => Artifact
  }) => Effect.gen(function*() {
    const context = yield* authorized(renderPermission)
    const existing = yield* options.findArtifact(context.organization.id, options.id)
    if (existing !== undefined) {
      const object = yield* Effect.either(dependencies.objects.readPdf(existing))
      if (Either.isRight(object)) return existing
    }
    const source = yield* options.findSource(context.organization.id, options.id)
    if (source === undefined) return yield* Effect.fail(missing(options.kind, options.id))
    const rendered = yield* options.renderSource(source)
    const stored = yield* dependencies.objects.putPdf(rendered.bytes)
    if (existing !== undefined) {
      if (stored.objectKey !== existing.objectKey
        || stored.sha256 !== existing.sha256
        || stored.byteLength !== existing.byteLength
        || rendered.templateVersion !== existing.templateVersion) {
        return yield* Effect.fail(new ArtifactConflict({ documentKind: options.kind, documentId: options.id }))
      }
      return existing
    }
    const generatedAt = yield* dependencies.clock
    return yield* options.saveArtifact(options.artifact({
      organizationId: context.organization.id,
      objectKey: stored.objectKey,
      sha256: stored.sha256,
      byteLength: stored.byteLength,
      mediaType: rendered.mediaType,
      templateVersion: rendered.templateVersion,
      generatedAt: generatedAt.toISOString(),
    }))
  })

  const renderInvoice = (invoiceId: string) => render({
    kind: "invoice", id: invoiceId,
    findArtifact: dependencies.repository.findArtifact,
    saveArtifact: dependencies.repository.saveArtifact,
    findSource: dependencies.source.findInvoice,
    renderSource: dependencies.renderer.render,
    artifact: (common) => ({ invoiceId, ...common }),
  })

  const renderProforma = (proformaId: string) => render({
    kind: "proforma", id: proformaId,
    findArtifact: dependencies.repository.findProformaArtifact,
    saveArtifact: dependencies.repository.saveProformaArtifact,
    findSource: dependencies.source.findProforma,
    renderSource: dependencies.renderer.renderProforma,
    artifact: (common) => ({ proformaId, ...common }),
  })

  const download = <Artifact extends InvoiceArtifact | ProformaArtifact>(options: {
    readonly resource: string
    readonly id: string
    readonly findArtifact: (organizationId: string, id: string) => Effect.Effect<Artifact | undefined, DocumentsFailure>
  }) => Effect.gen(function*() {
    const context = yield* authorized(readPermission)
    const artifact = yield* options.findArtifact(context.organization.id, options.id)
    if (artifact === undefined) return yield* Effect.fail(missing(options.resource, options.id))
    const bytes = yield* dependencies.objects.readPdf(artifact)
    return { artifact, bytes }
  })

  const downloadInvoice = (invoiceId: string) => download({
    resource: "invoice artifact", id: invoiceId, findArtifact: dependencies.repository.findArtifact,
  })
  const downloadProforma = (proformaId: string) => download({
    resource: "proforma artifact", id: proformaId, findArtifact: dependencies.repository.findProformaArtifact,
  })

  const listMissing = <Artifact extends InvoiceArtifact | ProformaArtifact>(options: {
    readonly listIds: (organizationId: string) => Effect.Effect<ReadonlyArray<string>, DocumentsFailure>
    readonly findArtifact: (organizationId: string, id: string) => Effect.Effect<Artifact | undefined, DocumentsFailure>
  }) => Effect.gen(function*() {
    const context = yield* authorized(renderPermission)
    const ids = yield* options.listIds(context.organization.id)
    const missingIds: Array<string> = []
    for (const id of ids) {
      const artifact = yield* options.findArtifact(context.organization.id, id)
      if (artifact === undefined) {
        missingIds.push(id)
      } else {
        const object = yield* Effect.either(dependencies.objects.readPdf(artifact))
        if (Either.isLeft(object)) missingIds.push(id)
      }
    }
    return missingIds
  })

  const listMissingInvoiceIds = () => listMissing({
    listIds: dependencies.source.listIssuedInvoiceIds, findArtifact: dependencies.repository.findArtifact,
  })
  const listMissingProformaIds = () => listMissing({
    listIds: dependencies.source.listProformaIds, findArtifact: dependencies.repository.findProformaArtifact,
  })

  return { renderInvoice, downloadInvoice, listMissingInvoiceIds, renderProforma, downloadProforma, listMissingProformaIds }
}

export type {
  ArtifactRepository,
  InvoiceArtifact,
  InvoiceRenderer,
  InvoiceSource,
  PdfObjectStore,
  ProformaArtifact,
  RenderableInvoice,
  RenderableProforma,
} from "./artifact-ports.ts"
