import { orDash } from "../../lib/format.ts"
import type { VatHistoryItem } from "../../lib/issuer-vat-regime.ts"

/**
 * The regimes the issuer has been in, read-only.
 *
 * A past period is a fiscal fact: the documents issued under it keep its rates,
 * so there is nothing here to edit — the current regime is moved by the form
 * above, which writes a new period rather than rewriting an old one. A period
 * whose stored rates name no regime this app knows says so instead of being
 * shown as "scutit", which would be a claim about someone's taxes.
 *
 * The heading belongs here rather than to the card above, so a profile with no
 * regime yet does not show a title over nothing.
 */
export const IssuerVatHistory = ({ history }: { readonly history: ReadonlyArray<VatHistoryItem> }) =>
  history.length === 0
    ? null
    : <><h3>Istoric regim TVA</h3><div className="table-wrap">
      <table>
        <caption className="sr-only">Istoricul regimurilor TVA înregistrate</caption>
        <thead><tr><th scope="col">Regim</th><th scope="col">Cote</th><th scope="col">De la</th><th scope="col">Până la</th></tr></thead>
        <tbody>
          {history.map((item) => <tr key={`${item.effectiveFrom}-${item.effectiveTo ?? "prezent"}`}>
            <td data-label="Regim">{item.registered === undefined
              ? "Regim nerecunoscut"
              : item.registered ? "Plătitor TVA" : "Scutit TVA — art. 310"}</td>
            <td data-label="Cote">{item.rates}</td>
            <td data-label="De la">{item.effectiveFrom}</td>
            <td data-label="Până la">{orDash(item.effectiveTo)}</td>
          </tr>)}
        </tbody>
      </table>
    </div></>
