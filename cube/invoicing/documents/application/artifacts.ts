import { Effect } from "effect"

import { createArtifactOperations, type ArtifactServiceDependencies } from "./artifact-operations.ts"
import {
  DocumentsPermissionDenied,
  type DocumentsFailure,
  type InvoiceArtifact,
  type ProformaArtifact,
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

  return { renderInvoice, downloadInvoice, listMissingInvoiceIds, renderProforma, downloadProforma, listMissingProformaIds }
}

export type { ArtifactServiceDependencies } from "./artifact-operations.ts"
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
