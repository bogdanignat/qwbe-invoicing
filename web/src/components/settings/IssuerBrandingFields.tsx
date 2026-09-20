import { IssuerBrand } from "../document/IssuerBrand.tsx"
import { ErrorAlert } from "../layout/AsyncState.tsx"
import { Button } from "../ui/Button.tsx"
import type { useIssuerSettings } from "../../hooks/issuer-settings-hooks.ts"

export const IssuerBrandingFields = ({ state }: { readonly state: ReturnType<typeof useIssuerSettings> }) => <fieldset className="branding-fields">
  <legend>Brand documente <span className="optional">opțional</span></legend>
  <label>Text de brand <span className="optional">maximum 80 de caractere</span><input name="brandingText" value={state.branding.text} aria-invalid={state.branding.error !== null} aria-describedby={state.branding.error === null ? undefined : "issuer-brand-text-error"} onChange={(event) => { state.branding.changeText(event.currentTarget.value) }} /></label>
  {state.branding.error === null ? null : <div id="issuer-brand-text-error"><ErrorAlert error={state.branding.error} /></div>}
  <label htmlFor="issuer-brand-image">Siglă PNG sau JPEG <span className="optional">maximum 256 KiB</span></label>
  <input id="issuer-brand-image" type="file" accept="image/png,image/jpeg,.jpg,.jpeg" aria-invalid={state.branding.imageError !== null} aria-describedby={state.branding.imageError === null ? "issuer-brand-image-hint" : "issuer-brand-image-hint issuer-brand-image-error"} onChange={(event) => { void state.branding.selectImage(event.currentTarget.files?.[0]); event.currentTarget.value = "" }} />
  <p className="hint" id="issuer-brand-image-hint">Maximum 2048 px pe axă și 4 megapixeli.</p>
  {state.branding.imageError === null ? null : <div id="issuer-brand-image-error"><ErrorAlert error={state.branding.imageError} /><Button type="button" variant="secondary" size="small" onClick={state.branding.discardRejectedImage}>Renunță la fișierul respins</Button></div>}
  {state.branding.pending ? <p className="status-note" role="status">Se validează imaginea…</p> : null}
  {state.branding.image === null ? null : <div className="branding-preview"><IssuerBrand branding={{ text: null, image: { pngBase64: state.branding.image.dataBase64, width: state.branding.image.width, height: state.branding.image.height } }} imageSrc={state.branding.image.previewUrl} /><Button type="button" variant="secondary" size="small" onClick={state.branding.removeImage}>Elimină sigla</Button></div>}
  {state.branding.text === "" && state.branding.image === null ? null : <Button type="button" variant="danger" size="small" onClick={state.branding.removeAll}>Elimină tot brandingul</Button>}
</fieldset>
