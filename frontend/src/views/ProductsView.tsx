"use client"

import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Button } from "../components/Button.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ProductPresetEditorSection } from "../components/registry/ProductPresetEditorSection.tsx"
import { ProductPresetsRegistrySection } from "../components/registry/ProductPresetsRegistrySection.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useProductPresets } from "../hooks/use-product-presets.ts"

/**
 * The product catalogue: the saved products on the left, the editor on the
 * right, and one notice under the header for the write that just landed.
 *
 * The screen decides nothing: what may be saved, what refuses it and what the
 * notice says were all settled by the model before this rendered. The keyboard
 * move to the editor's heading belongs to the editor, which owns that ref.
 */
export const ProductsView = () => {
  const shell = useAuthenticatedShell()
  const catalogue = useProductPresets()
  const { load } = catalogue
  return <PrivateScreen shell={shell}>
    <Page title="Produse" eyebrow="Catalog"
      actions={load.kind === "ready"
        ? <Button onClick={catalogue.startCreate} disabled={catalogue.pending}>Produs nou</Button>
        : undefined}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {load.kind === "loading" ? <Loading label="Se încarcă produsele…" /> : null}
      {load.kind === "error" ? <ErrorAlert error={load.error} onRetry={catalogue.retry} /> : null}
      {load.kind === "ready"
        ? <>
          {catalogue.notice === undefined ? null : <p className="status-note" role="status">{catalogue.notice}</p>}
          {catalogue.editing === undefined && catalogue.error !== null && catalogue.error !== undefined
            ? <ErrorAlert error={catalogue.error} />
            : null}
          <div className="authoring-layout">
            <ProductPresetsRegistrySection rows={catalogue.rows} editingId={catalogue.editing?.id}
              disabled={catalogue.pending} hasMore={catalogue.hasMore} loadingMore={catalogue.loadingMore}
              onLoadMore={catalogue.loadMore}
              onEdit={(row) => { catalogue.startEdit(row.preset) }}
              onDelete={(row) => { catalogue.remove(row.preset) }} />
            <div className="authoring-side">
              {catalogue.form === undefined
                ? <section className="card"><p className="setup-note">Alege un produs din listă ca să îl modifici, sau adaugă unul nou.</p></section>
                : <ProductPresetEditorSection form={catalogue.form} editingId={catalogue.editing?.id}
                  units={catalogue.units} vatOptions={catalogue.vatOptions} issue={catalogue.issue}
                  pending={catalogue.pending} error={catalogue.error}
                  onChange={catalogue.change} onSubmit={catalogue.submit} onClose={catalogue.close} />}
            </div>
          </div>
        </>
        : null}
    </Page>
  </PrivateScreen>
}
