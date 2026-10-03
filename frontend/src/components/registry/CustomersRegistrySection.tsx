"use client"

import { Button } from "../Button.tsx"
import { EmptyState } from "../AsyncState.tsx"
import { LoadMore } from "../LoadMore.tsx"
import { identifierLabel } from "../../lib/document-authoring-transitions.ts"
import { orDash } from "../../lib/format.ts"
import type { Customer } from "../../lib/draft-models.ts"

interface CustomersRegistrySectionProps {
  readonly customers: ReadonlyArray<Customer>
  readonly editingId: string | undefined
  readonly disabled: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
  readonly onEdit: (customer: Customer) => void
  readonly onDelete: (customer: Customer) => void
}

const addressLine = (customer: Customer): string => {
  const { address } = customer
  const sector = address.sector === undefined ? "" : `, sector ${String(address.sector)}`
  return `${address.street}, ${address.city}${sector}`
}

/** The saved parties, as they are reused on a document. */
export const CustomersRegistrySection = (props: CustomersRegistrySectionProps) =>
  <section className="card">
    <div className="section-heading">
      <div>
        <h2>Clienți salvați</h2>
        <p>Documentele deja emise păstrează copia proprie a cumpărătorului: o modificare aici nu le schimbă.</p>
      </div>
      <span className="count">{props.customers.length}</span>
    </div>
    {props.customers.length === 0
      ? <EmptyState>Nu există încă clienți salvați.</EmptyState>
      : <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">Client</th><th scope="col">Identificator fiscal</th>
          <th scope="col">Adresă</th><th scope="col" className="numeric">Termen</th>
          <th scope="col"><span className="sr-only">Acțiuni</span></th>
        </tr></thead>
        <tbody>
          {props.customers.map((customer) => <tr key={customer.id}>
            <td>
              <span className="party-name">{customer.name}</span>
              <small>{customer.partyType === "company" ? "Persoană juridică" : "Persoană fizică"}{customer.vatRegistered ? " · plătitor de TVA" : ""}</small>
            </td>
            <td>{orDash(customer.fiscalIdentifier)}<small>{identifierLabel(customer.partyType)}</small></td>
            <td>{addressLine(customer)}<small>{customer.address.county}{customer.address.postalCode === undefined ? "" : ` · ${customer.address.postalCode}`}</small></td>
            <td className="numeric">{customer.defaultPaymentTermDays === undefined ? "—" : `${String(customer.defaultPaymentTermDays)} zile`}</td>
            <td><div className="draft-item-actions">
              <Button className="secondary" disabled={props.disabled}
                aria-current={props.editingId === customer.id ? "true" : undefined}
                onClick={() => { props.onEdit(customer) }}>
                Editează<span className="sr-only"> {customer.name}</span>
              </Button>
              <Button className="danger" disabled={props.disabled} onClick={() => { props.onDelete(customer) }}>
                Șterge<span className="sr-only"> {customer.name}</span>
              </Button>
            </div></td>
          </tr>)}
        </tbody>
      </table></div>}
    <LoadMore visible={props.hasMore} pending={props.loadingMore} onClick={props.onLoadMore} />
  </section>
