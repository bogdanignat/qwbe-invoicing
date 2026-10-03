import { proformasQueryKey } from "./proforma-query-keys.ts"
import { useAuthoringPagedList, type AuthoringPagedList } from "./use-authoring-paged-list.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { projectProformaRegister, type ProformaRegisterRow } from "../lib/proforma-projection.ts"
import type { Proforma } from "../lib/proforma-models.ts"

/**
 * The proforma registry: one cursor page per fetch, with the rows already shaped.
 *
 * The presentation is derived here rather than in the table, so the component is
 * left with markup and the shaping stays testable without rendering. The rows are
 * `undefined` exactly while the items are — a screen must be able to tell "no
 * answer yet" from "an answer with nothing in it", and an empty array would make
 * a failed first read look like an empty registry.
 *
 * The key is the shared `["proformas"]`, not one private to this hook: every
 * proforma write invalidates it, including a replay that runs after a reload
 * while this screen is not mounted.
 */
export interface ProformaRegisterModel extends AuthoringPagedList<Proforma> {
  readonly rows: ReadonlyArray<ProformaRegisterRow> | undefined
}

export const useProformas = (): ProformaRegisterModel => {
  const clients = useInvoicingClients()
  const list = useAuthoringPagedList<Proforma>(
    proformasQueryKey,
    (page, signal) => clients.proformas.listProformas(page, signal),
  )
  return {
    ...list,
    rows: list.items === undefined ? undefined : projectProformaRegister(list.items),
  }
}
