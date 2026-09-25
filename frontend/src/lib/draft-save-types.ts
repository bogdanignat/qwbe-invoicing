import type {
  CreateDraftInput, DraftInvoice, DraftLineInput, UpdateDraftInput,
} from "./draft-models.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"

export interface DraftSaveClient {
  /** The whole document in one request, under a key chosen before it leaves. */
  readonly createDraft: (csrfToken: string, body: CreateDraftInput, idempotencyKey: string) => Promise<DraftInvoice>
  /** The stored request, sent exactly as it was sent: a replay must not be rebuilt from the current form. */
  readonly replayDraftCreation: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
  readonly getDraft: (id: string) => Promise<DraftInvoice>
  readonly updateDraft: (csrfToken: string, id: string, body: UpdateDraftInput) => Promise<DraftInvoice>
  readonly addDraftLine: (csrfToken: string, id: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly updateDraftLine: (csrfToken: string, id: string, lineId: string, body: DraftLineInput) => Promise<DraftInvoice>
  readonly deleteDraftLine: (csrfToken: string, id: string, lineId: string) => Promise<DraftInvoice>
  readonly deleteDraft: (csrfToken: string, id: string) => Promise<void>
}

/**
 * The effects a save produces, applied by the hook that owns the React side.
 * The controller calls them only while the session and the screen are still
 * the ones the save started in: a late answer after logout, re-login or
 * unmount belongs to nobody and is dropped, not applied.
 */
export interface DraftSaveEffects {
  readonly recordDraft: (draft: DraftInvoice) => void
  readonly recordLines: (lines: ReadonlyArray<EditableInvoiceLine>) => void
  readonly removeLine: (lineKey: string) => void
  readonly invalidateDrafts: () => void
  readonly evictDraft: (id: string) => void
  readonly notify: (message: string) => void
  readonly navigate: (path: string) => void
}

export interface DraftSaveDependencies {
  readonly client: DraftSaveClient
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  /** Whether the screen that started the write is still mounted. */
  readonly alive: () => boolean
  readonly effects: DraftSaveEffects
  readonly recovery: RecoveryPort
}

export type SaveOutcome =
  | { readonly kind: "saved" }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }
  /** The server's state is unknowable from here: resubmitting could duplicate, so it is blocked until reconciliation. */
  | { readonly kind: "unconfirmed"; readonly message: string }

export interface SaveRequest {
  readonly draft: DraftInvoice | undefined
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly forcedUpdateLineIds: (draft: DraftInvoice) => ReadonlyArray<string>
  /** A document created in this view moves to its own draft URL once saved. */
  readonly navigateOnCreate: boolean
}

export type WriteResult = { readonly draft: DraftInvoice } | { readonly outcome: SaveOutcome }

/** A fresh read of the draft: `aborted` when the session ended, `failed` when the read told nothing usable. */
export type Fresh =
  | { readonly kind: "aborted" }
  | { readonly kind: "failed" }
  | { readonly kind: "draft"; readonly draft: DraftInvoice }

export const UNCONFIRMED_CREATE = "Rezultatul salvării nu este confirmat: cererea poate să fi ajuns sau nu la server. Întoarce-te la registrul de facturi, reîncarcă lista de drafturi și deschide draftul creat înainte de a continua."
export const UNCONFIRMED_LINE = "Rezultatul salvării liniei nu poate fi confirmat, iar un nou „Salvează” ar putea dubla linii. Întoarce-te la registrul de facturi, reîncarcă lista de drafturi și deschide draftul înainte de a continua."
export const UNCONFIRMED_HEADER = "Rezultatul salvării datelor generale nu poate fi confirmat, iar un nou „Salvează” ar putea dubla modificările. Întoarce-te la registrul de facturi, reîncarcă lista de drafturi și deschide draftul înainte de a continua."
export const DERIVED_DRAFT_DELETE_REFUSED = "Draftul creat din proformă nu poate fi șters: proforma sursă îl controlează. Deschide proforma din care a fost creat dacă vrei să renunți la el."
export const ISSUED_DRAFT_DELETE_REFUSED = "Draftul a fost deja emis ca document fiscal și nu mai poate fi șters."
