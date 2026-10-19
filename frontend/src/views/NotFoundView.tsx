import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { AppLink } from "../components/ui/AppLink.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"

/** An address no screen answers: said plainly, inside the usual frame, with the way home. */
export const NotFoundView = () => {
  const shell = useAuthenticatedShell()
  return <PrivateScreen shell={shell}>
    <Page title="Pagina nu există" eyebrow="Adresă necunoscută">
      <p className="setup-note">Adresa deschisă nu corespunde niciunui ecran din aplicație. <AppLink href="/">Mergi la pagina de start</AppLink>.</p>
    </Page>
  </PrivateScreen>
}
