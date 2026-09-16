import { Data } from "effect"

export type DocumentKind = "invoice" | "proforma"

export class DocumentsPermissionDenied extends Data.TaggedError("DocumentsPermissionDenied")<{
  readonly permission: string
}> {}
export class DocumentNotFound extends Data.TaggedError("DocumentNotFound")<{
  readonly resource: string
  readonly id: string
}> {}
export class DocumentPersistenceFailure extends Data.TaggedError("DocumentPersistenceFailure")<{
  readonly operation: string
}> {}
export class DocumentRenderingFailure extends Data.TaggedError("DocumentRenderingFailure")<{
  readonly template: string
}> {}
export class ArtifactConflict extends Data.TaggedError("ArtifactConflict")<{
  readonly documentKind: DocumentKind
  readonly documentId: string
}> {}

export type DocumentsFailure = DocumentsPermissionDenied | DocumentNotFound
  | DocumentPersistenceFailure | DocumentRenderingFailure | ArtifactConflict
