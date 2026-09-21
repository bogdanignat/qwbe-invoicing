import { useEffect, useRef } from "react"
import { CustomerEditorSection } from "../components/customers/CustomerEditorSection.tsx"
import { CustomersRegistrySection } from "../components/customers/CustomersRegistrySection.tsx"
import { ErrorAlert, Loading } from "../components/layout/AsyncState.tsx"
import { Page } from "../components/layout/Page.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { useCustomerRegistry } from "../hooks/customer-registry-hooks.ts"
import { focusAndReveal } from "../lib/focus.ts"

export const CustomersView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useCustomerRegistry(notify)
  const editHeading = useRef<HTMLHeadingElement>(null)
  const editing = state.editing
  useEffect(() => {
    if (editing === undefined) return
    focusAndReveal(editHeading.current)
  }, [editing])
  if (state.customers.items === undefined) return state.customers.error === null
    ? <Loading />
    : <Page title="Clienți" eyebrow="Registru"><ErrorAlert error={state.customers.error} /></Page>
  return <Page title="Clienți" eyebrow="Registru activ" actions={<ButtonLink href="/invoices/new">Factură nouă</ButtonLink>}><div className="split-layout"><CustomersRegistrySection state={state} /><CustomerEditorSection state={state} headingRef={editHeading} /></div></Page>
}
