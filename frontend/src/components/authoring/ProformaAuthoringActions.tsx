"use client"

import type { ProformaAuthoringSession } from "../../hooks/proforma-authoring-session-types.ts"
import { Button } from "../Button.tsx"

/**
 * The single write this screen makes, next to what it will produce.
 *
 * No totals are shown: the server computes them when it answers, and a proforma
 * is authored in one request, so there is no saved state to preview against.
 * A missing series is a setup note here rather than a refusal state — the form
 * stays fillable, only the save is closed.
 */
export const ProformaAuthoringActions = ({ session }: { readonly session: ProformaAuthoringSession }) => {
  const { status } = session
  return <>
    <section className="card authoring-section">
      <h2>Totaluri</h2>
      <p className="hint">Totalurile vor fi calculate la salvarea proformei.</p>
    </section>
    <section className="card authoring-section">
      <h2>Acțiuni proformă</h2>
      {status.seriesMissing
        ? <p className="status-note warning" role="status">Nu există nicio serie de proforme configurată. Adaugă o serie pentru proforme în aplicația existentă, apoi revino aici.</p>
        : null}
      <Button className="full-width" type="submit" disabled={!status.canSave}>
        {status.pending ? "Se salvează…" : "Salvează proforma"}
      </Button>
      <p className="hint">Proforma primește un număr la salvare și rămâne imuabilă. Nu este document fiscal și nu se trimite la e-Factura.</p>
    </section>
  </>
}
