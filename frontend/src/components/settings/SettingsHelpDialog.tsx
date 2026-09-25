"use client"

import { Button } from "../Button.tsx"
import { SettingsHelpIdentity } from "./SettingsHelpIdentity.tsx"
import { SettingsHelpVat } from "./SettingsHelpVat.tsx"
import { useHelpDialog } from "../../hooks/use-help-dialog.ts"

/**
 * The field guide, in a native modal dialog.
 *
 * `<dialog>` with `showModal` is what makes the keyboard behave: the browser
 * keeps Tab inside the dialog, marks the page behind it inert and closes on
 * Escape, none of which a hand-written trap does as reliably. The two closing
 * controls are `form method="dialog"` submits for the same reason — the browser
 * closes the dialog, so there is no state to keep in sync — and the focus is
 * handed back to the button that opened it on the dialog's own `close` event,
 * which Escape fires too.
 */
export const SettingsHelpDialog = () => {
  const [dialog, help] = useHelpDialog()
  return <>
    <Button className="secondary" aria-haspopup="dialog" onClick={help.open}>
      <span aria-hidden="true">ⓘ</span> Ajutor pentru câmpuri
    </Button>
    <dialog ref={dialog} className="settings-help-dialog" aria-labelledby="settings-help-title"
      onClose={help.restoreFocus}>
      <header>
        <div><p className="eyebrow">Ghid de completare</p>
          <h2 id="settings-help-title">Ce înseamnă câmpurile din „Date firmă”</h2></div>
        <form method="dialog">
          <button className="dialog-close" type="submit" aria-label="Închide ghidul">×</button>
        </form>
      </header>
      <div className="settings-help-body"><SettingsHelpIdentity /><SettingsHelpVat /></div>
      <form className="dialog-actions" method="dialog"><Button type="submit">Am înțeles</Button></form>
    </dialog>
  </>
}
