import { Effect } from "effect"

import { createArtifactOperations, type ArtifactServiceDependencies } from "./artifact-operations.ts"
import {
  DocumentNotFound,
  DocumentsPermissionDenied,
  type DocumentsFailure,
  type InvoiceArtifact,
  type ProformaArtifact,
  type RenderedDocument,
  type RequestContext,
} from "./artifact-ports.ts"

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
  /** Corrections are immutable rows, so their PDF is rendered on every request instead of stored. */
  readonly renderCorrection: (correctionId: string) => Effect.Effect<RenderedDocument, DocumentsFailure>
}

export const createArtifactService = (dependencies: ArtifactServiceDependencies): ArtifactService => {
  const readPermission = `${dependencies.cubeIdentity}:read`
  const renderPermission = `${dependencies.cubeIdentity}:render`
  const authorized = (permission: string): Effect.Effect<RequestContext, DocumentsFailure> =>
    Effect.flatMap(dependencies.context, (context) =>
      context.identity.permissions.includes(permission)
        ? Effect.succeed(context)
        : Effect.fail(new DocumentsPermissionDenied({ permission })))
  const { render, download, listMissing } = createArtifactOperations(dependencies, authorized, { readPermission, renderPermission })

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

  const downloadInvoice = (invoiceId: string) => download({
    resource: "invoice artifact", id: invoiceId, findArtifact: dependencies.repository.findArtifact,
  })
  const downloadProforma = (proformaId: string) => download({
    resource: "proforma artifact", id: proformaId, findArtifact: dependencies.repository.findProformaArtifact,
  })

  const listMissingInvoiceIds = () => listMissing({
    listIds: dependencies.source.listIssuedInvoiceIds, findArtifact: dependencies.repository.findArtifact,
  })
  const listMissingProformaIds = () => listMissing({
    listIds: dependencies.source.listProformaIds, findArtifact: dependencies.repository.findProformaArtifact,
  })

  const renderCorrection = (correctionId: string) => Effect.gen(function*() {
    const context = yield* authorized(readPermission)
    const correction = yield* dependencies.source.findCorrection(context.organization.id, correctionId)
    if (correction === undefined) return yield* Effect.fail(new DocumentNotFound({ resource: "correction", id: correctionId }))
    return yield* dependencies.renderer.renderCorrection(correction)
  })

  return {
    renderInvoice, downloadInvoice, listMissingInvoiceIds, renderProforma, downloadProforma, listMissingProformaIds,
    renderCorrection,
  }
}

export type { ArtifactServiceDependencies } from "./artifact-operations.ts"
export type {
  ArtifactRepository,
  InvoiceArtifact,
  InvoiceRenderer,
  InvoiceSource,
  PdfObjectStore,
  ProformaArtifact,
  RenderableCorrection,
  RenderableInvoice,
  RenderableProforma,
} from "./artifact-ports.ts"
