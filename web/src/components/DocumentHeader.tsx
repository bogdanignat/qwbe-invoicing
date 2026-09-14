import type { ReactNode } from "react"

interface DocumentHeaderProps {
  readonly identity: ReactNode
  readonly issuer: ReactNode
  readonly customer: ReactNode
}

export const DocumentHeader = ({ identity, issuer, customer }: DocumentHeaderProps) => <header className="document-header">
  <div className="document-header__identity">{identity}</div>
  <div className="document-header__issuer">{issuer}</div>
  <div className="document-header__customer">{customer}</div>
</header>
